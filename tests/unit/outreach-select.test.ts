import { describe, expect, it } from "vitest";

import { scegliProposte, type Candidato, type StoricoProposta } from "@/lib/outreach/select";

const ORA = new Date("2026-09-20T10:00:00Z");
const giorniFa = (n: number) => new Date(ORA.getTime() - n * 86_400_000).toISOString();

function cand(over: Partial<Candidato> = {}): Candidato {
  return {
    leadId: over.leadId ?? "l1",
    contactId: "c1",
    title: "Studio Dentistico Bianchi",
    tags: [],
    email: "info@bianchi.it",
    isBlocked: false,
    stageSlug: "da-contattare",
    ...over,
  };
}

describe("scegliProposte", () => {
  it("primo contatto per un lead in Da contattare con email", () => {
    const r = scegliProposte([cand()], [], ORA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ leadId: "l1", kind: "first_contact", toAddress: "info@bianchi.it" });
  });
  it("salta bloccati e senza email", () => {
    const r = scegliProposte([cand({ isBlocked: true }), cand({ leadId: "l2", email: null })], [], ORA);
    expect(r).toHaveLength(0);
  });
  it("salta chi ha già una proposta negli ultimi 7 giorni, di qualunque stato", () => {
    const storico: StoricoProposta[] = [
      { leadId: "l1", kind: "first_contact", status: "rejected", createdAt: giorniFa(3), sentAt: null },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("salta chi ha già ricevuto il primo contatto anche se vecchio", () => {
    const storico: StoricoProposta[] = [
      { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(30), sentAt: giorniFa(30) },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("ricontatto: In attesa, primo contatto inviato da ≥7 giorni, nessun ricontatto prima", () => {
    const c = cand({ stageSlug: "in-attesa" });
    const inviato: StoricoProposta = { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(9), sentAt: giorniFa(8) };
    expect(scegliProposte([c], [inviato], ORA)[0]).toMatchObject({ kind: "followup" });
    const giaRicontattato: StoricoProposta = { leadId: "l1", kind: "followup", status: "rejected", createdAt: giorniFa(8), sentAt: null };
    expect(scegliProposte([c], [inviato, giaRicontattato], ORA)).toHaveLength(0);
    const troppoPresto: StoricoProposta = { ...inviato, createdAt: giorniFa(5), sentAt: giorniFa(5) };
    expect(scegliProposte([c], [troppoPresto], ORA)).toHaveLength(0);
  });
  it("mai più di 20 per giro", () => {
    const tanti = Array.from({ length: 50 }, (_, i) => cand({ leadId: `l${i}` }));
    expect(scegliProposte(tanti, [], ORA)).toHaveLength(20);
  });
});