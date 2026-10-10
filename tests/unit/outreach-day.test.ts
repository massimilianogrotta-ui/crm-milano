import { describe, expect, it } from "vitest";
import { giornataRoma } from "@/lib/outreach/day";

describe("giornataRoma", () => {
  it("usa mezzanotte italiana in inverno e in estate", () => {
    expect(giornataRoma(new Date("2026-01-10T12:00:00Z"))).toEqual({
      inizio: "2026-01-09T23:00:00.000Z", fine: "2026-01-10T23:00:00.000Z",
    });
    expect(giornataRoma(new Date("2026-07-10T12:00:00Z"))).toEqual({
      inizio: "2026-07-09T22:00:00.000Z", fine: "2026-07-10T22:00:00.000Z",
    });
  });
  it("conta correttamente le giornate da 23 e 25 ore", () => {
    const primavera = giornataRoma(new Date("2026-03-29T12:00:00Z"));
    const autunno = giornataRoma(new Date("2026-10-25T12:00:00Z"));
    expect(Date.parse(primavera.fine) - Date.parse(primavera.inizio)).toBe(23 * 3_600_000);
    expect(Date.parse(autunno.fine) - Date.parse(autunno.inizio)).toBe(25 * 3_600_000);
  });
});
