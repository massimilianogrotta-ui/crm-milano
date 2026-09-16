import { describe, expect, it } from "vitest";

import { renderOutreach, segmentoDelLead } from "@/lib/outreach/templates";

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
  it("mette il nome dello studio e il footer STOP", () => {
    const r = renderOutreach({ kind: "first_contact", segmento: "dentista", nomeStudio: "Studio Bianchi" });
    expect(r.templateRef).toBe("first_contact.dentista.v1");
    expect(r.subject).toContain("Demo 10 min");
    expect(r.body).toContain("«Studio Bianchi»");
    expect(r.body).toContain("STOP");
    expect(r.body).toContain("https://demo-mini.all-io.com");
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