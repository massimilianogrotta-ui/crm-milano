import { describe, expect, it } from "vitest";

import { outreachDryRun } from "@/lib/outreach/config";

describe("outreachDryRun", () => {
  it("è acceso se la variabile manca", () => {
    expect(outreachDryRun(undefined)).toBe(true);
    expect(outreachDryRun("")).toBe(true);
  });
  it("si spegne SOLO con la stringa esatta 'false'", () => {
    expect(outreachDryRun("false")).toBe(false);
    expect(outreachDryRun("FALSE")).toBe(true);
    expect(outreachDryRun("0")).toBe(true);
    expect(outreachDryRun("no")).toBe(true);
  });
});