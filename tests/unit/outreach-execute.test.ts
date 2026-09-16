import { describe, expect, it, vi } from "vitest";

import { eseguiDecisione, type DipendenzeEsecuzione, type PropostaDaEseguire } from "@/lib/outreach/execute";

const P: PropostaDaEseguire = {
  id: "p1", organizationId: "o1", leadId: "l1", contactId: "c1", kind: "first_contact",
  status: "pending", toAddress: "info@x.it", subject: "S", body: "B", contactBlocked: false,
};

function deps(over: Partial<DipendenzeEsecuzione> = {}): DipendenzeEsecuzione {
  return {
    dryRun: false,
    send: vi.fn(async () => ({ ok: true, id: "re_1" })),
    salva: vi.fn(async () => true),
    spostaInAttesa: vi.fn(async () => "movido" as const),
    nota: vi.fn(async () => undefined),
    ...over,
  };
}

describe("eseguiDecisione", () => {
  it("rifiuta: nessun invio, nessuno spostamento", async () => {
    const d = deps();
    const r = await eseguiDecisione(P, { azione: "rifiuta", userId: "u1" }, d);
    expect(r.status).toBe("rejected");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("dry-run: nessun invio ma sent+sposta+nota", async () => {
    const d = deps({ dryRun: true });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.status).toBe("sent");
    expect(d.salva).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", dry_run: true }));
    expect(d.spostaInAttesa).toHaveBeenCalled();
    expect(d.nota).toHaveBeenCalled();
  });
  it("invio reale ok", async () => {
    const d = deps();
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ to: "info@x.it", subject: "S" }));
    expect(r.status).toBe("sent");
    expect(d.salva).toHaveBeenCalledWith(expect.objectContaining({ provider_message_id: "re_1", dry_run: false }));
  });
  it("invio fallito: failed, niente spostamento", async () => {
    const d = deps({ send: vi.fn(async () => ({ ok: false, error: "send_failed" as const })) });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("failed");
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("contatto bloccato nel frattempo: nessun invio", async () => {
    const d = deps();
    const r = await eseguiDecisione({ ...P, contactBlocked: true }, { azione: "approva", userId: "u1" }, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.status).toBe("rejected");
  });
  it("proposta non più pending: nessuna azione", async () => {
    const d = deps();
    const r = await eseguiDecisione({ ...P, status: "sent" }, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("non_pending");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.salva).not.toHaveBeenCalled();
  });
  it("ricontatto approvato: non sposta lo stage", async () => {
    const d = deps();
    await eseguiDecisione({ ...P, kind: "followup" }, { azione: "approva", userId: "u1" }, d);
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("salvataggio concorrente perso: nessun invio", async () => {
    const d = deps({ salva: vi.fn(async () => false) });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("non_pending");
    expect(d.send).not.toHaveBeenCalled();
  });
});