import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isOutreachDryRun } from "@/lib/outreach/config";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true, id: "non-deve-partire" })) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail, fromAddress: vi.fn() }));

import { generaProposte } from "@/lib/outreach/generate";
import { loadTestEnvFiles } from "../setup/vitest.setup";

const PLACEHOLDER_RESEND = "re_test_placeholder";

function letterali(src: string): string[] {
  const semCommenti = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...semCommenti.matchAll(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g)].map((m) =>
    m[0].slice(1, -1),
  );
}

function adminFinto() {
  const admin = {
    from(table: string) {
      let count = false;
      const q = {
        select(_columns: string, options?: { count?: string }) {
          if (options?.count) count = true;
          return q;
        },
        eq() { return q; },
        not() { return q; },
        gte() { return q; },
        lt() { return q; },
        order() { return q; },
        limit() { return q; },
        in() { return q; },
        maybeSingle: async () => ({ data: { id: "pipeline-1" }, error: null }),
        insert() { return q; },
        single: async () => ({ data: { id: "proposal-1" }, error: null }),
        then(resolve: (value: unknown) => void) {
          if (count) return resolve({ count: 0, error: null });
          if (table === "crm_stages") return resolve({ data: [{ id: "stage-1", slug: "da-contattare" }], error: null });
          if (table === "crm_leads") {
            return resolve({
              data: [{
                id: "lead-1",
                title: "Studio",
                tags: [],
                stage_id: "stage-1",
                contact_id: "contact-1",
                contacts: { email: "info@example.test", phone_number: null, is_blocked: false },
              }],
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  return admin;
}

describe("guardia: la suite non invia", () => {
  beforeEach(() => {
    sendEmail.mockClear();
  });

  it("il setup nomina solo .env.test", () => {
    const src = readFileSync(resolve(process.cwd(), "tests/setup/vitest.setup.ts"), "utf8");
    const envish = letterali(src).filter((s) => s.includes(".env"));
    expect(envish.length).toBeGreaterThan(0);
    expect(envish.every((s) => s === ".env.test")).toBe(true);
  });

  it("loadTestEnvFiles legge solo .env.test, con readFileSync spiato", () => {
    // `vi.spyOn(fs, "readFileSync")` non attacca: il namespace ESM di node:fs
    // non è configurabile. La spia è il vi.fn che il loader riceve al posto di
    // readFileSync e che delega alla funzione vera.
    const letti: string[] = [];
    const spy = vi.fn((path: Parameters<typeof readFileSync>[0], enc?: BufferEncoding) => {
      letti.push(String(path));
      return readFileSync(path, enc);
    });
    const tornati = loadTestEnvFiles(spy as typeof readFileSync);
    const envLetti = letti.filter((p) => p.includes(".env"));
    expect(spy).toHaveBeenCalled();
    expect(envLetti.length).toBeGreaterThan(0);
    expect(envLetti.every((p) => p.endsWith(".env.test"))).toBe(true);
    expect(tornati.every((p) => p.endsWith(".env.test"))).toBe(true);
    expect(process.env.OUTREACH_DRY_RUN).toBe("true");
    expect(process.env.OUTREACH_ORG_ID).toBe("");
  });

  it("isOutreachDryRun è true e l'org di outreach è vuota", () => {
    expect(isOutreachDryRun()).toBe(true);
    expect(process.env.OUTREACH_ORG_ID).toBe("");
  });

  it("RESEND_API_KEY non ha forma di chiave reale", () => {
    const key = process.env.RESEND_API_KEY ?? "";
    const reale = key !== PLACEHOLDER_RESEND && /^re_.{21,}$/.test(key);
    expect(reale).toBe(false);
  });

  it("nessun file di lib/outreach importa resend; l'unico invio è la server action", () => {
    const dir = resolve(process.cwd(), "lib/outreach");
    const files = readdirSync(dir).filter((n) => n.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from ["']@\/lib\/email\/resend["']/);
      expect(src, file).not.toMatch(/from ["']resend["']/);
    }
    const invio = readFileSync(resolve(process.cwd(), "app/actions/outreach/send-email.ts"), "utf8");
    expect(invio).toMatch(/from ["']@\/lib\/email\/resend["']/);
  });

  it("generaProposte con admin finto non chiama sendEmail", async () => {
    const esito = await generaProposte(adminFinto() as never, "org-di-test");
    expect(esito.stato).toBe("ok");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
