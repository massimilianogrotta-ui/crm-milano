import { describe, expect, it } from "vitest";

import { mittenteOutreach } from "@/lib/outreach/config";
import { OUTREACH_SIGNATURE, renderOutreach, segmentoDelLead } from "@/lib/outreach/templates";

describe("segmentoDelLead", () => {
  it("riconosce i dentisti da titolo o tag", () => {
    expect(segmentoDelLead({ title: "Studio Dentistico Bianchi", tags: [] })).toBe("dentista");
    expect(segmentoDelLead({ title: "Rossi", tags: ["odontoiatria"] })).toBe("dentista");
  });
  it("riconosce l'estetica", () => {
    expect(segmentoDelLead({ title: "Clinica Estetica Aurora", tags: [] })).toBe("estetica");
    expect(segmentoDelLead({ title: "Aurora", tags: ["centro estetico"] })).toBe("estetica");
  });
  it("altrimenti generico", () => {
    expect(segmentoDelLead({ title: "Aurora srl", tags: [] })).toBe("generico");
  });
});

describe("renderOutreach", () => {
  it("sollecito WhatsApp usa il Lei, demo e uscita STOP", () => {
    const r = renderOutreach({ kind: "followup", segmento: "dentista", nomeStudio: "Studio Bianchi" });
    expect(r.templateRef).toBe("wa.followup.dentista.v2");
    expect(r.body).toContain("Le avevo scritto");
    expect(r.body).toContain("https://demo-mini.all-io.com");
    expect(r.body).toContain("rispondere STOP");
    expect(r.body).not.toContain("Costo");
  });
  it("primo contatto v3: oggetto, Lei, firma unica e STOP", () => {
    const r = renderOutreach({ kind: "first_contact", segmento: "dentista", nomeStudio: "Studio Bianchi" });
    expect(r.templateRef).toBe("first_contact.dentista.v3");
    expect(r.subject).toBe("Studio Bianchi: contatti, appuntamenti e follow-up pazienti");
    expect(r.body).toContain("All-io CRM Assist");
    expect(r.body).toContain("risponda STOP");
    expect(r.body).toContain("Studio Bianchi");
    expect(r.body).toContain("senza cambiare gestionale");
    expect(r.body).toContain("nulla parte senza il suo ok");
    expect(r.body).toContain(OUTREACH_SIGNATURE);
    expect(r.body).not.toMatch(/costo|canon|€|prezz|\bMax\b|wa\.me/i);
    expect(mittenteOutreach().fromName).toBe(OUTREACH_SIGNATURE);
    expect(renderOutreach({ kind: "first_contact", segmento: "estetica", nomeStudio: "Centro Esempio" }).templateRef)
      .toBe("first_contact.estetica.v3");
    expect(renderOutreach({ kind: "first_contact", segmento: "estetica", nomeStudio: "Centro Esempio" }).subject)
      .toContain("follow-up clienti");
    expect(renderOutreach({ kind: "first_contact", segmento: "generico", nomeStudio: "Centro Esempio" }).templateRef)
      .toBe("first_contact.generico.v3");
  });
  it("non contiene mai prezzi", () => {
    for (const kind of ["first_contact", "followup"] as const) {
      for (const segmento of ["dentista", "estetica", "generico"] as const) {
        const r = renderOutreach({ kind, segmento, nomeStudio: "X" });
        expect(r.body).not.toMatch(/€|\beuro\b|\d+\s*,\d{2}/i);
      }
    }
  });
  it("ripulisce il nome da caratteri pericolosi", () => {
    const r = renderOutreach({ kind: "first_contact", segmento: "generico", nomeStudio: "A<script>\r\nB" });
    expect(r.body).not.toContain("<script>");
    expect(r.body).not.toContain("\r");
  });
});
