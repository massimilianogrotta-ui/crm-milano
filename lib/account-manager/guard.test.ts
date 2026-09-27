import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validate = vi.fn();
const auditFn = vi.fn();
const rate = vi.fn();

vi.mock("@/lib/mcp/auth", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, validateBearerToken: (h: string | null) => validate(h) };
});
vi.mock("@/lib/audit", () => ({ audit: (e: unknown) => auditFn(e) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rate(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ fake: true }) }));

import { McpAuthError } from "@/lib/mcp/auth";

import { withAccountManager } from "./guard";

const HOST = "srv.tailnet.ts.net:8443";

function req(opts: { host?: string; auth?: string; method?: string } = {}) {
  const headers = new Headers();
  headers.set("host", opts.host ?? HOST);
  if (opts.auth !== undefined) headers.set("authorization", opts.auth);
  return new NextRequest(`https://${opts.host ?? HOST}/api/v1/account-manager/contacts`, {
    method: opts.method ?? "GET",
    headers,
  });
}

function token(scopes: string[]) {
  return {
    organizationId: "org-1",
    role: "agent",
    actor: { type: "ai_agent", id: "tok-1", role: "agent", api_token_id: "tok-1" },
    apiTokenId: "tok-1",
    scopes,
  };
}

const okRun = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  process.env.ACCOUNT_MANAGER_ALLOWED_HOSTS = HOST;
  rate.mockResolvedValue({ allowed: true, count: 1, limit: 120, window_sec: 60 });
  validate.mockReset();
  auditFn.mockReset();
  okRun.mockClear();
});
afterEach(() => {
  delete process.env.ACCOUNT_MANAGER_ALLOWED_HOSTS;
});

describe("withAccountManager — arrivo", () => {
  it("API spenta (404) se ACCOUNT_MANAGER_ALLOWED_HOSTS non è impostata", async () => {
    delete process.env.ACCOUNT_MANAGER_ALLOWED_HOSTS;
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(404);
    expect(validate).not.toHaveBeenCalled();
    expect(okRun).not.toHaveBeenCalled();
  });

  it("404 da crm.all-io.com anche con token valido", async () => {
    validate.mockResolvedValue(token(["am:read"]));
    const res = await withAccountManager(req({ host: "crm.all-io.com", auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(404);
    expect(okRun).not.toHaveBeenCalled();
  });
});

describe("withAccountManager — token e scope", () => {
  it("401 senza Bearer, e la chiamata è registrata", async () => {
    const res = await withAccountManager(req(), "read", okRun);
    expect(res.status).toBe(401);
    expect(auditFn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_manager.api_call", metadata: expect.objectContaining({ status: 401 }) }),
    );
  });

  it("401 con token revocato", async () => {
    validate.mockRejectedValue(new McpAuthError(-32001, 401, "Token revoked."));
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(401);
    expect(okRun).not.toHaveBeenCalled();
  });

  it("403 per un token MCP generico (mcp:read/mcp:write) senza am:*", async () => {
    validate.mockResolvedValue(token(["mcp:read", "mcp:write"]));
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(403);
    expect(okRun).not.toHaveBeenCalled();
  });

  it("403 in scrittura con solo am:read", async () => {
    validate.mockResolvedValue(token(["am:read"]));
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y", method: "POST" }), "write", okRun);
    expect(res.status).toBe(403);
    expect(okRun).not.toHaveBeenCalled();
  });

  it("200 con am:read; org dal token; registro con token e stato", async () => {
    validate.mockResolvedValue(token(["am:read", "am:write"]));
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(200);
    expect(okRun).toHaveBeenCalledWith(expect.objectContaining({ organization_id: "org-1", tokenId: "tok-1" }));
    expect(auditFn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account_manager.api_call",
        organizationId: "org-1",
        actorApiTokenId: "tok-1",
        metadata: expect.objectContaining({ method: "GET", path: "/api/v1/account-manager/contacts", status: 200 }),
      }),
    );
  });

  it("429 oltre il limite al minuto, per token", async () => {
    validate.mockResolvedValue(token(["am:read"]));
    rate.mockResolvedValue({ allowed: false, count: 121, limit: 120, window_sec: 60 });
    const res = await withAccountManager(req({ auth: "Bearer dsk_x_y" }), "read", okRun);
    expect(res.status).toBe(429);
    expect(rate).toHaveBeenCalledWith("account-manager:tok-1", 120, 60);
    expect(okRun).not.toHaveBeenCalled();
  });
});

describe("superficie esposta", () => {
  const ROOT = join(process.cwd(), "app/api/v1/account-manager");
  const files: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "route.ts") files.push(p);
    }
  })(ROOT);

  it("nessuna rotta DELETE o PUT", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/export (async )?function (DELETE|PUT)\b/);
  });

  it("ogni rotta passa dal cancello", () => {
    for (const f of files) expect(readFileSync(f, "utf8")).toContain("withAccountManager(");
  });

  it("il codice dell'API non tocca invii né canali", () => {
    const src = [
      ...files,
      join(process.cwd(), "lib/account-manager/data.ts"),
    ].map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")).join("\n");
    expect(src).not.toMatch(/sendMessage|send-message|outreach|ensureConversation|waha|resend|createContactHandler/i);
  });
});
