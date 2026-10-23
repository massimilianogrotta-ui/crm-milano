import { describe, expect, it } from "vitest";

import { cellulareItaliano, scegliProposte, type Candidato, type StoricoProposta } from "@/lib/outreach/select";

const ORA = new Date("2026-09-20T10:00:00Z");
const giorniFa = (n: number) => new Date(ORA.getTime() - n * 86_400_000).toISOString();

function cand(over: Partial<Candidato> = {}): Candidato {
  return {
    leadId: over.leadId ?? "l1",
    contactId: "c1",
    title: "Studio Dentistico Bianchi",
    tags: [],
    contactTags: [],
    email: "info@bianchi.it",
    phone: "+39 333 1234567",
    isBlocked: false,
    stageSlug: "da-contattare",
    ...over,
  };
}

describe("scegliProposte", () => {
  const wa = { waFollowup: true, waGiorni: 10 };
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
      { leadId: "l1", kind: "first_contact", status: "rejected", createdAt: giorniFa(3), sentAt: null, dryRun: false },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("salta chi ha già ricevuto il primo contatto anche se vecchio", () => {
    const storico: StoricoProposta[] = [
      { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(30), sentAt: giorniFa(30), dryRun: false },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("ricontatto: In attesa, primo contatto vero e cellulare italiano", () => {
    const c = cand({ stageSlug: "in-attesa" });
    const inviato: StoricoProposta = { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(12), sentAt: giorniFa(11), dryRun: false };
    expect(scegliProposte([c], [inviato], ORA, wa)[0]).toMatchObject({ kind: "followup", channel: "wa", toAddress: "+393331234567" });
    const giaRicontattato: StoricoProposta = { leadId: "l1", kind: "followup", status: "rejected", createdAt: giorniFa(8), sentAt: null, dryRun: false };
    expect(scegliProposte([c], [inviato, giaRicontattato], ORA, wa)).toHaveLength(0);
    const troppoPresto: StoricoProposta = { ...inviato, createdAt: giorniFa(5), sentAt: giorniFa(5) };
    expect(scegliProposte([c], [troppoPresto], ORA, wa)).toHaveLength(0);
    expect(scegliProposte([c], [{ ...inviato, dryRun: true }], ORA, wa)).toHaveLength(0);
    expect(scegliProposte([cand({ stageSlug: "da-contattare" })], [{ ...inviato, dryRun: true, createdAt: giorniFa(1) }], ORA)[0]?.kind).toBe("first_contact");
    expect(scegliProposte([cand({ stageSlug: "in-attesa", phone: "0212345678" })], [inviato], ORA, wa)).toHaveLength(0);
    expect(scegliProposte([c], [inviato], ORA, { waFollowup: false })).toHaveLength(0);
  });
  it("un primo contatto rifiutato o approvato a metà non torna; uno fallito sì", () => {
    const vecchio = (status: StoricoProposta["status"]): StoricoProposta =>
      ({ leadId: "l1", kind: "first_contact", status, createdAt: giorniFa(30), sentAt: null, dryRun: false });
    expect(scegliProposte([cand()], [vecchio("rejected")], ORA)).toHaveLength(0);
    expect(scegliProposte([cand()], [vecchio("approved")], ORA)).toHaveLength(0);
    expect(scegliProposte([cand()], [vecchio("failed")], ORA)[0]?.kind).toBe("first_contact");
  });
  it("un ricontatto di prova non blocca il sollecito WhatsApp vero", () => {
    const c = cand({ stageSlug: "in-attesa" });
    const inviato: StoricoProposta = { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(12), sentAt: giorniFa(11), dryRun: false };
    const ricontattoProva: StoricoProposta = { leadId: "l1", kind: "followup", status: "sent", createdAt: giorniFa(20), sentAt: giorniFa(20), dryRun: true };
    expect(scegliProposte([c], [inviato, ricontattoProva], ORA, wa)[0]?.kind).toBe("followup");
  });
  it("mai più di 10 per giro", () => {
    const tanti = Array.from({ length: 50 }, (_, i) => cand({
      leadId: `l${i}`,
      contactId: `c${i}`,
      email: `info@bianchi${i}.it`,
    }));
    expect(scegliProposte(tanti, [], ORA)).toHaveLength(10);
  });
  it("4 lead sullo stesso contatto: vince il più vecchio, gli altri sono contatto condiviso", () => {
    const leads = [0, 1, 2, 3].map((i) => cand({ leadId: `l${i}`, contactId: "stesso", email: "info@bianchi.it" }));
    const r = scegliProposte(leads, [], ORA);
    expect(r.map((p) => p.leadId)).toEqual(["l0"]);
    expect(r.esclusi.contatto_condiviso).toBe(3);
    expect(r.esclusi.dominio_gia_nel_giro).toBe(0);
  });
  it("due contatti diversi, stesso dominio non freemail: una sola proposta", () => {
    const r = scegliProposte([
      cand({ leadId: "a", contactId: "c1", email: "info@dentalpro.it", title: "Dentalpro Milano" }),
      cand({ leadId: "b", contactId: "c2", email: "segreteria@dentalpro.it", title: "Dentalpro Milano" }),
    ], [], ORA);
    expect(r.map((p) => p.leadId)).toEqual(["a"]);
    expect(r.esclusi.dominio_gia_nel_giro).toBe(1);
  });
  it("un first_contact reale sullo stesso indirizzo, anche di un altro lead, blocca", () => {
    const storico: StoricoProposta[] = [{
      leadId: "altro", contactId: "c9", toAddress: "info@bianchi.it",
      kind: "first_contact", status: "sent", createdAt: giorniFa(40), sentAt: giorniFa(40), dryRun: false,
    }];
    const r = scegliProposte([cand({ contactId: "c1" })], storico, ORA);
    expect(r).toHaveLength(0);
    expect(r.esclusi.gia_contattato).toBe(1);
    const perContatto = scegliProposte(
      [cand({ email: "info@altro.it", title: "Altro Studio" })],
      [{ ...storico[0], toAddress: "info@altro.it", contactId: "c1" }],
      ORA,
    );
    expect(perContatto).toHaveLength(0);
  });
  it("un first_contact di prova o fallito sullo stesso indirizzo non blocca", () => {
    const base: StoricoProposta = {
      leadId: "altro", contactId: "c9", toAddress: "info@bianchi.it",
      kind: "first_contact", status: "sent", createdAt: giorniFa(40), sentAt: giorniFa(40), dryRun: true,
    };
    expect(scegliProposte([cand()], [base], ORA)).toHaveLength(1);
    expect(scegliProposte([cand()], [{ ...base, dryRun: false, status: "failed" }], ORA)).toHaveLength(1);
  });
});

describe("cellulareItaliano", () => {
  it.each(["+39 333 1234567", "0039 333 1234567", "393331234567", "3331234567"])("normalizza %s", (raw) => {
    expect(cellulareItaliano(raw)).toBe("+393331234567");
  });
  it.each(["0212345678", "+44 3331234567", "333123", null])("rifiuta %s", (raw) => {
    expect(cellulareItaliano(raw)).toBeNull();
  });
});
