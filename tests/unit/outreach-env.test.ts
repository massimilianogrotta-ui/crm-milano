import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mittenteOutreach, outreachDryRun, STATI_NEL_TETTO_INVII } from "@/lib/outreach/config";
import { OUTREACH_SIGNATURE } from "@/lib/outreach/templates";
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
      .toEqual({ fromName: OUTREACH_SIGNATURE, fromEmail: "max@example.it", replyTo: "reply@example.it" });
    expect(fromAddress(OUTREACH_SIGNATURE, "max@example.it")).toBe(`${OUTREACH_SIGNATURE} <max@example.it>`);
  });
  it("lascia il mittente generale quando sono assenti", () => {
    expect(mittenteOutreach("", ""))
      .toEqual({ fromName: OUTREACH_SIGNATURE, fromEmail: undefined, replyTo: undefined });
  });
});

describe("tettoInvii", () => {
  const ENV = "OUTREACH_TETTO_INVII";
  const original = process.env[ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    vi.resetModules();
  });

  async function carica(valor?: string) {
    vi.resetModules();
    if (valor === undefined) delete process.env[ENV];
    else process.env[ENV] = valor;
    const { tettoInvii } = await import("@/lib/outreach/config");
    const { env } = await import("@/lib/env");
    return { tettoInvii, grezzo: env.OUTREACH_TETTO_INVII };
  }

  it("senza variabile vale 5", async () => {
    const { tettoInvii, grezzo } = await carica(undefined);
    expect(grezzo).toBe(5);
    expect(tettoInvii()).toBe(5);
  });

  it("stringa vuota o non intera vale 5 e lo schema non lancia", async () => {
    for (const valor of ["", "   ", "abc", "1.5", "0x10", "1e2"]) {
      const { tettoInvii, grezzo } = await carica(valor);
      expect(grezzo, valor).toBe(5);
      expect(tettoInvii()).toBe(5);
    }
  });

  it("un intero decimale con spazi vale quel numero", async () => {
    const { tettoInvii, grezzo } = await carica("  12  ");
    expect(grezzo).toBe(12);
    expect(tettoInvii()).toBe(12);
  });

  it("i failed reali consumano il tetto, non solo sent e approved", () => {
    expect(STATI_NEL_TETTO_INVII.map((s) => s.status)).toEqual(["sent", "approved", "failed"]);
    expect(STATI_NEL_TETTO_INVII.find((s) => s.status === "failed")?.tempo).toBe("decided_at");
    const src = readFileSync(join(process.cwd(), "app/actions/outreach/decide.ts"), "utf8");
    expect(src).toContain("STATI_NEL_TETTO_INVII");
  });

  it("500 diventa 30 e zero o negativo diventano 1", async () => {
    expect((await carica("500")).tettoInvii()).toBe(30);
    expect((await carica("500")).grezzo).toBe(500);
    expect((await carica("0")).tettoInvii()).toBe(1);
    expect((await carica("-3")).tettoInvii()).toBe(1);
  });
});
