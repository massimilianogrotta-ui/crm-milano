/**
 * Contrato da assinatura que o kit Radio Banana passa a ligar.
 *
 * O WAHA assina com HMAC-SHA512 e manda o header `X-Webhook-Hmac` no formato
 * `sha512=<hex>`. `verifyHmacSha512` tira esse prefixo. Com
 * `WAHA_WEBHOOK_REQUIRE_SIGNATURE=false` (o padrão do compose) um evento sem
 * assinatura continua aceito; com `true`, falta ou assinatura inválida cai.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: { WAHA_HMAC_SECRET: "", WAHA_WEBHOOK_REQUIRE_SIGNATURE: "false" },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { authenticateWahaWebhook } from "./webhook-auth";

const BODY = '{"event":"message","session":"org_1","payload":{"id":"x"}}';
const SEGREDO = "fake-hmac-secret-for-tests-only";
const assina = (body: string, secret: string) =>
  `sha512=${createHmac("sha512", secret).update(body, "utf8").digest("hex")}`;

describe("authenticateWahaWebhook — HMAC sha512 do WAHA", () => {
  beforeEach(() => {
    envMock.WAHA_HMAC_SECRET = SEGREDO;
    envMock.WAHA_WEBHOOK_REQUIRE_SIGNATURE = "false";
  });

  it("aceita assinatura válida no formato sha512=<hex>", () => {
    const r = authenticateWahaWebhook({
      rawBody: BODY,
      signatureHeader: assina(BODY, SEGREDO),
      sessionSecret: null,
    });
    expect(r).toEqual({ ok: true, signatureVerified: true });
  });

  it("com require=true, assinatura ausente é rejeitada", () => {
    envMock.WAHA_WEBHOOK_REQUIRE_SIGNATURE = "true";
    const r = authenticateWahaWebhook({
      rawBody: BODY,
      signatureHeader: null,
      sessionSecret: null,
    });
    expect(r).toEqual({ ok: false, reason: "signature_required" });
  });

  it("com require=true, assinatura inválida é rejeitada", () => {
    envMock.WAHA_WEBHOOK_REQUIRE_SIGNATURE = "true";
    const r = authenticateWahaWebhook({
      rawBody: BODY,
      signatureHeader: `sha512=${"ab".repeat(64)}`,
      sessionSecret: null,
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("com require=false, evento sem assinatura continua aceito e não verificado", () => {
    const r = authenticateWahaWebhook({
      rawBody: BODY,
      signatureHeader: null,
      sessionSecret: null,
    });
    expect(r).toEqual({ ok: true, signatureVerified: false });
  });
});
