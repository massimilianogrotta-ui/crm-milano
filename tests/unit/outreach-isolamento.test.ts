import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function fileTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fileTs(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("agente outreach: l'LLM non può inviare", () => {
  it("nessun file del motore IA importa lib/outreach", () => {
    const colpevoli = [...fileTs(join(RAIZ, "lib", "agent-engine")), ...fileTs(join(RAIZ, "lib", "ai"))]
      .filter((f) => readFileSync(f, "utf8").includes("@/lib/outreach"));
    expect(colpevoli).toEqual([]);
  });
  it("lib/outreach non importa SDK di modelli", () => {
    const colpevoli = fileTs(join(RAIZ, "lib", "outreach"))
      .filter((f) => /from "(ai|@ai-sdk\/[^"]+|@anthropic-ai\/[^"]+|openai)"/.test(readFileSync(f, "utf8")));
    expect(colpevoli).toEqual([]);
  });
  it("solo la server action chiama l'invio email", () => {
    const colpevoli = fileTs(join(RAIZ, "lib", "outreach"))
      .filter((f) => readFileSync(f, "utf8").includes("@/lib/email/resend"));
    expect(colpevoli).toEqual([]);
  });
});