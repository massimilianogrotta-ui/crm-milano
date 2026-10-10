import { describe, expect, it } from "vitest";

import { mittenteOutreach, outreachDryRun } from "@/lib/outreach/config";
import { fromAddress } from "@/lib/email/resend";

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

describe("mittenteOutreach", () => {
  it("usa indirizzo e reply-to dedicati quando impostati", () => {
    expect(mittenteOutreach("max@example.it", "reply@example.it"))
      .toEqual({ fromName: "Max · All-io", fromEmail: "max@example.it", replyTo: "reply@example.it" });
    expect(fromAddress("Max · All-io", "max@example.it")).toBe("Max · All-io <max@example.it>");
  });
  it("lascia il mittente generale quando sono assenti", () => {
    expect(mittenteOutreach("", ""))
      .toEqual({ fromName: "Max · All-io", fromEmail: undefined, replyTo: undefined });
  });
});
