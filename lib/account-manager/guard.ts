/**
 * Cancello dell'API riservata dell'agente «Account manager» (/api/v1/account-manager/*).
 *
 * Tre chiavi, tutte obbligatorie, nell'ordine:
 *  1. ARRIVO — l'header `Host` deve essere uno di ACCOUNT_MANAGER_ALLOWED_HOSTS
 *     (il nome Tailscale del VPS). Senza la variabile l'API è SPENTA (404): chi
 *     arriva da crm.all-io.com passa da Caddy con Host=crm.all-io.com e trova 404.
 *  2. TOKEN — Bearer `dsk_` valido (api_tokens: non revocato, non scaduto) con
 *     scope `am:read` (GET) o `am:write` (scritture). Nessuna sessione cookie.
 *  3. RITMO — al massimo ACCOUNT_MANAGER_RATE_LIMIT chiamate al minuto per token.
 *
 * Ogni chiamata che supera il punto 1 finisce in `api_audit_log` con azione
 * `account_manager.api_call`: ora, token, metodo, percorso, esito.
 *
 * L'org viene SEMPRE dalla riga del token, mai dal client. Il client Supabase è
 * service-role: ogni query qui dentro DEVE filtrare per `organization_id`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { McpAuthError, ensureScope, extractBearer, validateBearerToken } from "@/lib/mcp/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type AmAccess = "read" | "write";

export interface AmCtx {
  supabase: ReturnType<typeof createAdminClient>;
  organization_id: string;
  actor: Actor;
  requestId: string;
  tokenId: string;
}

export function allowedHosts(): string[] {
  return (process.env.ACCOUNT_MANAGER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function rateLimit(): number {
  const n = Number(process.env.ACCOUNT_MANAGER_RATE_LIMIT ?? "120");
  return Number.isFinite(n) && n > 0 ? n : 120;
}

export async function withAccountManager(
  req: NextRequest,
  access: AmAccess,
  run: (ctx: AmCtx) => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID();

  const host = (req.headers.get("host") ?? "").toLowerCase();
  const hosts = allowedHosts();
  if (hosts.length === 0 || !hosts.includes(host)) {
    return fail("not_found", "Not found.", 404, { requestId });
  }

  const path = new URL(req.url).pathname;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent");
  let tokenId: string | undefined;
  let organizationId: string | undefined;
  let status = 500;

  try {
    if (!extractBearer(req.headers.get("authorization"))) {
      status = 401;
      return fail("unauthenticated", "Bearer token required.", 401, { requestId });
    }
    const auth = await validateBearerToken(req.headers.get("authorization"));
    tokenId = auth.apiTokenId;
    organizationId = auth.organizationId;
    ensureScope(auth.scopes, access === "read" ? "am:read" : "am:write");

    const rl = await checkRateLimit(`account-manager:${auth.apiTokenId}`, rateLimit(), 60);
    if (!rl.allowed) {
      status = 429;
      return fail("rate_limited", "Too many requests.", 429, { requestId });
    }

    const res = await run({
      supabase: createAdminClient(),
      organization_id: auth.organizationId,
      actor: auth.actor,
      requestId,
      tokenId: auth.apiTokenId,
    });
    status = res.status;
    return res;
  } catch (err) {
    if (err instanceof McpAuthError) {
      status = err.httpStatus;
      return fail(
        err.httpStatus === 403 ? "forbidden" : "unauthenticated",
        err.message,
        err.httpStatus,
        { requestId },
      );
    }
    if (err instanceof ApiError) {
      status = err.status;
      return fail(err.code, err.message, err.status, { requestId, details: err.details });
    }
    status = 500;
    console.error("[account-manager] errore", requestId, err);
    return fail("internal_error", "Internal error.", 500, { requestId });
  } finally {
    await audit({
      action: "account_manager.api_call",
      organizationId,
      actorApiTokenId: tokenId,
      resourceType: "account_manager_api",
      requestId,
      ip: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      bypassedRls: true,
      metadata: { method: req.method, path, status, access },
    });
  }
}

/** Legge e valida il JSON del corpo; 422 se non passa lo schema. */
export async function readBody<T>(
  req: NextRequest,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } },
  requestId: string,
): Promise<T> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "validation_failed", { issues: parsed.error.issues }, requestId, "Invalid body.");
  }
  return parsed.data;
}

/** Legge e valida la query string; 422 se non passa lo schema. */
export function readQuery<T>(
  req: NextRequest,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } },
  requestId: string,
): T {
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "validation_failed", { issues: parsed.error.issues }, requestId, "Invalid query.");
  }
  return parsed.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id di percorso: deve essere un uuid, altrimenti 404 (non si rivela nulla). */
export function readId(id: string, requestId: string): string {
  if (!UUID.test(id)) throw new ApiError(404, "not_found", undefined, requestId, "Not found.");
  return id;
}
