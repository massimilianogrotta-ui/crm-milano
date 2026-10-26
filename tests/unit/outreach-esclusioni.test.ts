import { describe, expect, it } from "vitest";

import { motivoEsclusione, type IngressoEsclusione } from "@/lib/outreach/esclusioni";
import { scegliProposte, type Candidato } from "@/lib/outreach/select";

/**
 * Stesse forme del blocco 1 (dominio professionale, nome.cognome, freemail,
 * pec, titolo di articolo), con indirizzi inventati: nessun indirizzo reale
 * di prospect entra nella suite.
 */
function ingresso(over: Partial<IngressoEsclusione> = {}): IngressoEsclusione {
  return { email: null, title: null, tags: [], contactTags: [], ...over };
}

const ORA = new Date("2026-09-20T10:00:00Z");

function cand(over: Partial<Candidato> = {}): Candidato {
  return {
    leadId: "l1",
    contactId: "c1",
    title: "Studio Dentistico Esempio",
    tags: [],
    contactTags: [],
    email: "info@studiodentisticoesempio.it",
    phone: null,
    isBlocked: false,
    stageSlug: "da-contattare",
    ...over,
  };
}

describe("motivoEsclusione", () => {
  it("dominio che non nomina l'attività", () => {
    expect(motivoEsclusione(ingresso({
      email: "info@avvocatoesempio.it",
      title: "Dentix Italia",
    }))).toBe("dominio_incoerente");
    expect(motivoEsclusione(ingresso({
      email: "sitiweb@agenziaesempio.com",
      title: "Studio Dentistico Fiume",
    }))).toBe("dominio_incoerente");
  });

  it("nome.cognome è nominativa, prima del dominio", () => {
    expect(motivoEsclusione(ingresso({
      email: "mario.rossi@ospedaleesempio.it",
      title: "Ospedale Esempio",
    }))).toBe("nominativa");
  });

  it("freemail", () => {
    expect(motivoEsclusione(ingresso({ email: "esempionail@hotmail.it" }))).toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@gmail.com" }))).toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@yahoo.co.uk" }))).toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@outlook.com" }))).toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@live.it" }))).toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@libero.it" }))).toBe("freemail");
    for (const domain of [
      "tin.it", "msn.com", "aol.com", "me.com", "email.it", "fastwebnet.it",
      "inwind.it", "iol.it", "googlemail.com", "proton.me", "gmx.com", "gmx.de",
    ]) {
      expect(motivoEsclusione(ingresso({ email: `info@${domain}` })), domain).toBe("freemail");
    }
    expect(motivoEsclusione(ingresso({ email: "info@gmxmail.com" }))).not.toBe("freemail");
    expect(motivoEsclusione(ingresso({ email: "info@protonmail.com" }))).not.toBe("freemail");
  });

  it("titoli che sono articoli", () => {
    expect(motivoEsclusione(ingresso({ title: "Ogni quanto cambiare lo spazzolino" }))).toBe("titolo_articolo");
    expect(motivoEsclusione(ingresso({ title: "5 segreti per avere ciglia lunghe e sane" }))).toBe("titolo_articolo");
    expect(motivoEsclusione(ingresso({ title: "Come scegliere lo spazzolino?" }))).toBe("titolo_articolo");
  });

  it("pec: suffisso del gestore o label esatta pec, anche con email-verificata", () => {
    const domini = [
      "studio.pec.it",
      "pec.studio.it",
      "legalmail.it",
      "mx.legalmail.it",
      "impresa.italia.it",
      "posta.impresa.italia.it",
      "postecert.it",
      "mx.postecert.it",
      "a.b.postecert.it",
      "postacert.it",
      "mx.postacert.it",
      "sicurezzapostale.it",
      "mx.sicurezzapostale.it",
      "actaliscertymail.it",
      "cert.actaliscertymail.it",
    ];
    for (const domain of domini) {
      expect(motivoEsclusione(ingresso({
        email: `info@${domain}`,
        title: "Studio",
        contactTags: ["email-verificata"],
      })), domain).toBe("pec");
    }
    expect(motivoEsclusione(ingresso({
      email: "info@studiospeciale.it",
      title: "Studio Speciale",
      contactTags: ["email-verificata"],
    }))).toBeNull();
    expect(motivoEsclusione(ingresso({ email: "info@notpostecert.it", title: "Studio" }))).toBeNull();
    expect(motivoEsclusione(ingresso({ email: "info@postecert.it.evil.test", title: "Studio" }))).toBeNull();
  });

  it("casella generica e dominio coerente: non si esclude", () => {
    expect(motivoEsclusione(ingresso({
      email: "info@studiodentisticoesempio.it",
      title: "Studio Dentistico Esempio",
    }))).toBeNull();
    expect(motivoEsclusione(ingresso({
      email: "info@centrodentisticobeta.it",
      title: "Centro Dentistico Beta",
    }))).toBeNull();
  });

  it("studio.rossi non è un nome di persona", () => {
    expect(motivoEsclusione(ingresso({
      email: "studio.rossi@rossistudio.it",
      title: "Studio Rossi",
    }))).toBeNull();
  });

  it("stop sul lead o sul contatto, senza guardare le maiuscole", () => {
    expect(motivoEsclusione(ingresso({
      email: "info@studiodentisticoesempio.it",
      title: "Studio Dentistico Esempio",
      tags: ["STOP"],
    }))).toBe("stop");
    expect(motivoEsclusione(ingresso({
      email: "info@studiodentisticoesempio.it",
      title: "Studio Dentistico Esempio",
      contactTags: ["Stop"],
    }))).toBe("stop");
  });

  it("email-verificata sul contatto salta solo il dominio incoerente", () => {
    expect(motivoEsclusione(ingresso({
      email: "info@avvocatoesempio.it",
      title: "Dentix Italia",
      contactTags: ["email-verificata"],
    }))).toBeNull();
  });

  it("un titolo lungo con i due punti è un articolo", () => {
    const titolo = "Centro Dentistico Esempio: guida completa alla prima visita e a cosa portare";
    expect(titolo.length).toBeGreaterThan(70);
    expect(motivoEsclusione(ingresso({
      email: "info@centrodentisticoesempio.it",
      title: titolo,
    }))).toBe("titolo_articolo");
  });
});

describe("scegliProposte scarta gli esclusi e li conta", () => {
  it("un set misto tiene solo il caso coerente", () => {
    const r = scegliProposte([
      cand(),
      cand({ leadId: "inc", contactId: "c2", email: "info@avvocatoesempio.it", title: "Dentix Italia" }),
      cand({ leadId: "web", contactId: "c3", email: "sitiweb@agenziaesempio.com", title: "Studio Dentistico Fiume" }),
      cand({ leadId: "nom", contactId: "c4", email: "mario.rossi@ospedaleesempio.it", title: "Ospedale Esempio" }),
      cand({ leadId: "free", contactId: "c5", email: "esempionail@hotmail.it" }),
      cand({ leadId: "art", contactId: "c6", email: "info@spazzolinoesempio.it", title: "Ogni quanto cambiare lo spazzolino" }),
      cand({ leadId: "pec", contactId: "c7", email: "x@studio.pec.it" }),
      cand({ leadId: "ok2", contactId: "c8", email: "info@centrodentisticobeta.it", title: "Centro Dentistico Beta" }),
    ], [], ORA);
    expect(r.map((p) => p.leadId)).toEqual(["l1", "ok2"]);
    expect(r.esclusi).toMatchObject({
      dominio_incoerente: 2,
      nominativa: 1,
      freemail: 1,
      titolo_articolo: 1,
      pec: 1,
      stop: 0,
    });
  });
});
