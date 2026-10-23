import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contatoriVuoti } from "@/lib/outreach/esclusioni";
import { logger } from "@/lib/logger";
import { generaProposte } from "@/lib/outreach/generate";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

function client(qtd: number, opts: { giorno?: number; pending?: number; erroreStorico?: number; senzaEmail?: number; storico?: Record<string, unknown>[] } = {}) {
  const blocos: string[][] = [];
  const colonne: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const filters: string[] = [];
  const leads = Array.from({ length: qtd }, (_, i) => ({
    id: `lead-${i}`, title: "Studio", tags: [], stage_id: "stage-1", contact_id: `contact-${i}`,
    contacts: { email: `info@studio${i}.test`, phone_number: "+39 333 1234567", is_blocked: false },
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
        in(column: string, ids: string[]) {
          if (table === "outreach_proposals") {
            blocos.push(ids);
            colonne.push(column);
          }
          return q;
        },
        maybeSingle: async () => ({ data: { id: "pipeline-1" }, error: null }),
        insert(row: Record<string, unknown>) { inserts.push(row); return q; },
        single: async () => ({ data: { id: `proposal-${inserts.length}` }, error: null }),
        then(resolve: (value: unknown) => void) {
          if (count) return resolve({ count: pending ? opts.pending ?? 0 : opts.giorno ?? 0, error: null });
          if (table === "crm_stages") return resolve({ data: [{ id: "stage-1", slug: "da-contattare" }], error: null });
          if (table === "crm_leads") return resolve({ data: leads.slice(opts.senzaEmail ?? 0, (opts.senzaEmail ?? 0) + 500), error: null });
          if (table === "outreach_proposals") return resolve({ data: opts.storico ?? [], error: blocos.length === opts.erroreStorico ? { message: "storico indisponibile" } : null });
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  return { admin: admin as unknown as SupabaseClient, blocos, colonne, inserts, filters, leads };
}

beforeEach(() => vi.clearAllMocks());

describe("generaProposte", () => {
  it("legge 500 lead utili in cinque blocchi senza ripetizioni", async () => {
    const { admin, blocos, colonne, leads, filters } = client(500);
    const esito = await generaProposte(admin, "org-1");
    expect(esito.candidati).toBe(500);
    expect(filters).toContain("contacts.email:is:null");
    expect(filters).toContain("contacts.is_blocked:false");
    expect(filters).toContain("organization_id:org-1");
    const perLead = blocos.filter((_, i) => colonne[i] === "lead_id");
    expect(perLead).toHaveLength(5);
    expect(perLead.flat()).toEqual(leads.map((l) => l.id));
    expect(colonne.filter((c) => c === "contact_id")).toHaveLength(5);
    expect(colonne.filter((c) => c === "to_address")).toHaveLength(5);
  });
  it("il filtro email precede il limite di 500", async () => {
    const { admin, filters } = client(1000, { senzaEmail: 500 });
    const esito = await generaProposte(admin, "org-1");
    expect(esito.candidati).toBe(500);
    expect(filters).toContain("contacts.email:is:null");
  });
  it("ferma il giro se lo storico fallisce", async () => {
    const { admin, blocos, colonne, inserts } = client(492, { erroreStorico: 3 });
    const esito = await generaProposte(admin, "org-1");
    expect(esito).toEqual({ stato: "errore", candidati: 492, create: 0, errore: "storico indisponibile", esclusi: contatoriVuoti() });
    expect(blocos).toHaveLength(3);
    expect(colonne).toEqual(["lead_id", "lead_id", "lead_id"]);
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
    expect(esito).toEqual({ stato: "ok", candidati: 228, create: 10, esclusi: contatoriVuoti() });
    expect(inserts).toHaveLength(10);
  });

  it("un first_contact reale sullo stesso indirizzo, anche di un altro lead, non crea proposte", async () => {
    const { admin, inserts } = client(1, {
      storico: [{
        id: "s1", lead_id: "altro", contact_id: "contact-0", to_address: "info@studio0.test",
        kind: "first_contact", status: "sent", created_at: "2026-01-01T00:00:00.000Z",
        sent_at: "2026-01-01T00:00:00.000Z", dry_run: false,
      }],
    });
    const esito = await generaProposte(admin, "org-1");
    expect(esito.create).toBe(0);
    expect(esito.esclusi.gia_contattato).toBe(1);
    expect(inserts).toHaveLength(0);
  });

  it("cerca e salva l'indirizzo senza spazi e in minuscolo", async () => {
    const { admin, leads, colonne, blocos, inserts } = client(1);
    leads[0]!.contacts.email = "  Info@Studio0.TEST ";
    const esito = await generaProposte(admin, "org-1");
    expect(esito.create).toBe(1);
    const indirizzi = blocos.filter((_, i) => colonne[i] === "to_address").flat();
    expect(indirizzi).toEqual(["info@studio0.test"]);
    expect(inserts[0]?.to_address).toBe("info@studio0.test");
  });

  it("un first_contact di prova sullo stesso indirizzo non blocca", async () => {
    const { admin } = client(1, {
      storico: [{
        id: "s1", lead_id: "altro", contact_id: "altro", to_address: "info@studio0.test",
        kind: "first_contact", status: "sent", created_at: "2026-01-01T00:00:00.000Z",
        sent_at: "2026-01-01T00:00:00.000Z", dry_run: true,
      }],
    });
    expect((await generaProposte(admin, "org-1")).create).toBe(1);
  });
});
