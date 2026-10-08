import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { MAX_ID_PER_LETTURA, MAX_PROPOSTE_PER_GIRO } from "@/lib/outreach/config";
import { generaProposte } from "@/lib/outreach/generate";

vi.mock("@/lib/env", () => ({ env: { OUTREACH_DRY_RUN: "true" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

function adminFinto(numeroLead: number, erroreStoricoAlBlocco = 0) {
  const chiamateStorico: string[][] = [];
  const inserimenti: unknown[] = [];
  let blocco = 0;
  const leads = Array.from({ length: numeroLead }, (_, i) => ({
    id: `lead-${i}`, title: `Studio ${i}`, tags: [], stage_id: "stage-1", contact_id: `contact-${i}`,
    contacts: { email: `studio${i}@example.test`, is_blocked: false },
  }));
  const from = vi.fn((tabella: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn((campo: string, valori: string[]) => {
        if (tabella === "outreach_proposals" && campo === "lead_id") chiamateStorico.push(valori);
        return query;
      }),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: leads, error: null })),
      maybeSingle: vi.fn(async () => ({ data: { id: "pipeline-1" }, error: null })),
      insert: vi.fn((riga: unknown) => { inserimenti.push(riga); return query; }),
      single: vi.fn(async () => ({ data: { id: `proposal-${inserimenti.length}` }, error: null })),
      then: (resolve: (value: unknown) => unknown) => {
        if (tabella === "crm_stages") {
          return Promise.resolve(resolve({ data: [{ id: "stage-1", slug: "da-contattare" }], error: null }));
        }
        blocco++;
        const error = blocco === erroreStoricoAlBlocco
          ? { message: "fetch failed", cause: new Error("network unavailable") }
          : null;
        return Promise.resolve(resolve({ data: [], error }));
      },
    };
    return query;
  });
  return { admin: { from } as unknown as SupabaseClient, chiamateStorico, inserimenti, from };
}

beforeEach(() => vi.clearAllMocks());

describe("generaProposte", () => {
  it("legge 492 lead a blocchi di 100 e crea al massimo 20 proposte", async () => {
    const finto = adminFinto(492);
    const esito = await generaProposte(finto.admin, "org-1");

    expect(esito).toMatchObject({ stato: "ok", candidati: 492, create: MAX_PROPOSTE_PER_GIRO });
    expect(finto.chiamateStorico.map((ids) => ids.length)).toEqual([100, 100, 100, 100, 92]);
    expect(finto.chiamateStorico.every((ids) => ids.length <= MAX_ID_PER_LETTURA)).toBe(true);
    expect(finto.inserimenti).toHaveLength(20);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("registra l'errore di una lettura dello storico e interrompe le proposte", async () => {
    const finto = adminFinto(492, 2);
    const esito = await generaProposte(finto.admin, "org-1");

    expect(esito).toMatchObject({ stato: "errore", candidati: 492, create: 0 });
    expect(finto.chiamateStorico).toHaveLength(2);
    expect(finto.inserimenti).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith("[outreach] lettura storico fallita", {
      organization_id: "org-1", error: "fetch failed (cause: network unavailable)",
    });
  });

  it("senza candidati non interroga lo storico", async () => {
    const finto = adminFinto(0);
    expect(await generaProposte(finto.admin, "org-1")).toMatchObject({ stato: "ok", candidati: 0, create: 0 });
    expect(finto.chiamateStorico).toHaveLength(0);
  });
});
