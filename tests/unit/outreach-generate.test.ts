import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { generaProposte } from "@/lib/outreach/generate";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

function client(qtd: number, opts: { giorno?: number; pending?: number; erroreStorico?: number; senzaEmail?: number } = {}) {
  const blocos: string[][] = [];
  const inserts: Record<string, unknown>[] = [];
  const filters: string[] = [];
  const leads = Array.from({ length: qtd }, (_, i) => ({
    id: `lead-${i}`, title: "Studio", tags: [], stage_id: "stage-1", contact_id: `contact-${i}`,
    contacts: { email: `lead${i}@example.test`, phone_number: "+39 333 1234567", is_blocked: false },
  }));
  const admin = {
    from(table: string) {
      let count = false;
      let pending = false;
      const q = {
        select(_columns: string, options?: { count?: string }) { if (options?.count) count = true; return q; },
        eq(column: string, value: unknown) { if (column === "status" && value === "pending") pending = true; filters.push(`${column}:${value}`); return q; },
        not(column: string, operator: string, value: unknown) { filters.push(`${column}:${operator}:${value}`); return q; },
        gte() { return q; }, lt() { return q; }, order() { return q; }, limit() { return q; },
        in(_column: string, ids: string[]) {
          if (table === "outreach_proposals") blocos.push(ids);
          return q;
        },
        maybeSingle: async () => ({ data: { id: "pipeline-1" }, error: null }),
        insert(row: Record<string, unknown>) { inserts.push(row); return q; },
        single: async () => ({ data: { id: `proposal-${inserts.length}` }, error: null }),
        then(resolve: (value: unknown) => void) {
          if (count) return resolve({ count: pending ? opts.pending ?? 0 : opts.giorno ?? 0, error: null });
          if (table === "crm_stages") return resolve({ data: [{ id: "stage-1", slug: "da-contattare" }], error: null });
          if (table === "crm_leads") return resolve({ data: leads.slice(opts.senzaEmail ?? 0, (opts.senzaEmail ?? 0) + 500), error: null });
          if (table === "outreach_proposals") return resolve({ data: [], error: blocos.length === opts.erroreStorico ? { message: "storico indisponibile" } : null });
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  return { admin: admin as unknown as SupabaseClient, blocos, inserts, filters, leads };
}

beforeEach(() => vi.clearAllMocks());

describe("generaProposte", () => {
  it("legge 500 lead utili in cinque blocchi senza ripetizioni", async () => {
    const { admin, blocos, leads, filters } = client(500);
    const esito = await generaProposte(admin, "org-1");
    expect(esito.candidati).toBe(500);
    expect(filters).toContain("contacts.email:is:null");
    expect(filters).toContain("contacts.is_blocked:false");
    expect(blocos).toHaveLength(5);
    expect(blocos.flat()).toEqual(leads.map((l) => l.id));
  });
  it("il filtro email precede il limite di 500", async () => {
    const { admin, filters } = client(1000, { senzaEmail: 500 });
    const esito = await generaProposte(admin, "org-1");
    expect(esito.candidati).toBe(500);
    expect(filters).toContain("contacts.email:is:null");
  });
  it("ferma il giro se lo storico fallisce", async () => {
    const { admin, blocos, inserts } = client(492, { erroreStorico: 3 });
    const esito = await generaProposte(admin, "org-1");
    expect(esito).toEqual({ stato: "errore", candidati: 492, create: 0, errore: "storico indisponibile" });
    expect(blocos).toHaveLength(3);
    expect(inserts).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
  it.each([
    [{ giorno: 9 }, 1], [{ pending: 9 }, 1], [{ giorno: 10 }, 0], [{ pending: 10 }, 0],
  ])("rispetta il limite giornaliero e pending %j", async (opts, previsto) => {
    const { admin, inserts } = client(228, opts);
    const esito = await generaProposte(admin, "org-1");
    expect(esito.create).toBe(previsto);
    expect(inserts).toHaveLength(previsto);
  });

  it("crea al massimo 10 proposte con 228 candidati e storico vuoto", async () => {
    const { admin, inserts } = client(228);
    const esito = await generaProposte(admin, "org-1");
    expect(esito).toEqual({ stato: "ok", candidati: 228, create: 10 });
    expect(inserts).toHaveLength(10);
  });
});
