import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { generaProposte } from "@/lib/outreach/generate";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

function client(qtd: number, blocoComErro = -1) {
  const blocos: string[][] = [];
  const inserts: unknown[] = [];
  const leads = Array.from({ length: qtd }, (_, i) => ({
    id: `lead-${i}`, title: "Studio", tags: [], stage_id: "stage-1", contact_id: `contact-${i}`,
    contacts: { email: `lead${i}@example.test`, is_blocked: false },
  }));
  const admin = {
    from(tabela: string) {
      if (tabela === "crm_pipelines") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pipeline-1" }, error: null }) }) }) }) };
      if (tabela === "crm_stages") return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: [{ id: "stage-1", slug: "da-contattare" }], error: null }) }) }) }) };
      if (tabela === "crm_leads") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: leads, error: null }) }) }) }) }) }) }) };
      return {
        select: () => ({ eq: () => ({ eq: () => ({ in: async (_campo: string, ids: string[]) => {
          blocos.push(ids);
          return { data: [], error: blocos.length === blocoComErro ? { message: "storico indisponibile" } : null };
        } }) }) }),
        insert: (riga: unknown) => {
          inserts.push(riga);
          return { select: () => ({ single: async () => ({ data: { id: `proposal-${inserts.length}` }, error: null }) }) };
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, blocos, inserts, leads };
}

beforeEach(() => vi.clearAllMocks());

describe("generaProposte", () => {
  it("legge 492 lead in cinque blocchi senza ripetizioni", async () => {
    const { admin, blocos, leads } = client(492);
    const esito = await generaProposte(admin, "org-1");
    expect(esito.stato).toBe("ok");
    expect(blocos).toHaveLength(5);
    expect(blocos.every((b) => b.length <= 100)).toBe(true);
    expect(blocos.flat()).toEqual(leads.map((l) => l.id));
    expect(new Set(blocos.flat()).size).toBe(492);
  });

  it("ferma il giro e registra il primo blocco fallito", async () => {
    const { admin, blocos, inserts } = client(492, 3);
    const esito = await generaProposte(admin, "org-1");
    expect(esito).toEqual({ stato: "errore", candidati: 492, create: 0, errore: "storico indisponibile" });
    expect(blocos).toHaveLength(3);
    expect(inserts).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith("[outreach] giro in errore", {
      organization_id: "org-1", fase: "storico", error: "storico indisponibile",
    });
  });

  it("crea al massimo 10 proposte con 228 candidati e storico vuoto", async () => {
    const { admin, inserts } = client(228);
    const esito = await generaProposte(admin, "org-1");
    expect(esito).toEqual({ stato: "ok", candidati: 228, create: 10 });
    expect(inserts).toHaveLength(10);
  });
});
