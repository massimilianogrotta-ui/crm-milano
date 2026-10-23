/**
 * Il compose di Radio Banana deve consegnare lo stesso segreto al WAHA e
 * all'app, per interpolazione, e non esigere la firma finché qualcuno non
 * lo accende. Il valore non sta nel file.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("tools/deploy/crm-radiobanana/docker-compose.yml", "utf8");
const esempio = readFileSync("tools/deploy/crm-radiobanana/.env.example", "utf8");

const INTERPOLAZIONE = "${WAHA_HMAC_SECRET:?set WAHA_HMAC_SECRET in .env}";

describe("crm-radiobanana — HMAC dei webhook WAHA", () => {
  it("dà WHATSAPP_HOOK_HMAC_KEY e WAHA_HMAC_SECRET dalla stessa variabile", () => {
    expect(compose).toContain(`WHATSAPP_HOOK_HMAC_KEY: ${INTERPOLAZIONE}`);
    expect(compose).toContain(`WAHA_HMAC_SECRET: ${INTERPOLAZIONE}`);
  });

  it("lascia l'obbligo di firma spento, con default false", () => {
    expect(compose).toContain(
      "WAHA_WEBHOOK_REQUIRE_SIGNATURE: ${WAHA_WEBHOOK_REQUIRE_SIGNATURE:-false}",
    );
    expect(compose).not.toMatch(/WAHA_WEBHOOK_REQUIRE_SIGNATURE:\s*["']?true["']?/);
  });

  it("non scrive un segreto nel compose né nell'esempio", () => {
    expect(compose).not.toMatch(/WAHA_HMAC_SECRET:\s*["']?[0-9a-f]{32,}/i);
    expect(esempio).toMatch(/^WAHA_HMAC_SECRET=\s*$/m);
    expect(esempio).toContain("openssl rand -hex 32");
    expect(esempio).not.toMatch(/^WAHA_HMAC_SECRET=[0-9a-f]{16,}/m);
  });
});
