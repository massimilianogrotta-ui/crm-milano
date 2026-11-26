import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateBeforeSend, type GateContext } from "@/lib/agent-engine/guardrails/before-send";
import { textoLivreForaDaJanela } from "@/lib/channels/janela";
import { sendTemplate } from "@/lib/channels/meta/send-template";
import { statusAnterioresPermitidos } from "@/lib/channels/meta/status-entrega";
import { checarGuardasDeContato } from "@/lib/automation/guarda-do-contato";
import type { ActionCtx } from "@/lib/automation/types";
import { mapHeader, mapLinha } from "@/lib/contacts/csv";
import {
  decidirEnvioDeMarketing,
  mesclarConsentimentoDeMarketing,
  registrarConsentimento,
} from "@/lib/contacts/consentimento";
import { maskPhone, redactPhones } from "@/lib/phones/mask";
import { paisPadraoDoTelefone } from "@/lib/phones/pais";
import { normalizePhone, normalizePhoneBR } from "@/lib/webhooks/inbound";

const EC = "+593991234567";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("telefone por país", () => {
  it("Equador lê o tronco 0 e o país sem sinal", () => {
    expect(normalizePhone("0991234567", "EC")).toBe(EC);
    expect(normalizePhone("593991234567", "EC")).toBe(EC);
    expect(normalizePhone("+593 99 123 4567", "EC")).toBe(EC);
  });

  it("Brasil não muda", () => {
    for (const amostra of ["11999998888", "0991234567", "+5511999998888", "5511999998888", "+593 99 123 4567"]) {
      expect(normalizePhone(amostra, "BR")).toBe(normalizePhoneBR(amostra));
    }
  });

  it("país da organização só sai de EC explícito", () => {
    expect(paisPadraoDoTelefone(undefined)).toBe("BR");
    expect(paisPadraoDoTelefone({})).toBe("BR");
    expect(paisPadraoDoTelefone({ phone_default_country: "ZZ" })).toBe("BR");
    expect(paisPadraoDoTelefone({ phone_default_country: "EC" })).toBe("EC");
  });

  it("planilha equatoriana com coluna de consentimento", () => {
    const cabecalho = mapHeader(["nome", "telefone", "consentimiento"], (s) => s);
    expect(cabecalho.motivo).toBeNull();
    const linha = mapLinha(["Ana", "0991234567", "si"], cabecalho.indices, undefined, "EC");
    expect(linha.motivo).toBeNull();
    expect(linha.contato.phone_number).toBe(EC);
    expect(linha.marketingConsent).toBe(true);
  });
});

describe("status de entrega só avança", () => {
  it("read alcança delivered e sent, e failed não desfaz leitura", () => {
    expect(statusAnterioresPermitidos("delivered")).toEqual(["queued", "sending", "received", "sent"]);
    expect(statusAnterioresPermitidos("read")).toContain("delivered");
    expect(statusAnterioresPermitidos("read")).not.toContain("read");
    expect(statusAnterioresPermitidos("failed")).not.toContain("delivered");
    expect(statusAnterioresPermitidos("failed")).not.toContain("read");
    expect(statusAnterioresPermitidos("played")).toBeNull();
  });
});

describe("consentimento de marketing", () => {
  it("só MARKETING com a flag ligada e sem carimbo é recusado", () => {
    expect(decidirEnvioDeMarketing({ requireMarketingConsent: false, category: "MARKETING", grantedAt: null }).permitido).toBe(true);
    expect(decidirEnvioDeMarketing({ requireMarketingConsent: true, category: "UTILITY", grantedAt: null }).permitido).toBe(true);
    expect(decidirEnvioDeMarketing({ requireMarketingConsent: true, category: null, grantedAt: null }).permitido).toBe(true);
    expect(decidirEnvioDeMarketing({ requireMarketingConsent: true, category: "MARKETING", grantedAt: "2026-01-01T00:00:00.000Z" }).permitido).toBe(true);
    expect(decidirEnvioDeMarketing({ requireMarketingConsent: true, category: "MARKETING", grantedAt: null })).toEqual({
      permitido: false,
      code: "marketing_consent_required",
    });
  });

  it("o grant novo apaga a recusa e preserva o resto", () => {
    const merged = mesclarConsentimentoDeMarketing(
      { marketing: { declined_at: "ontem", granted_at: null }, transactional: { granted_at: "fica" } },
      { grantedAt: "agora", source: "api", version: "v1" },
    );
    expect(merged.transactional).toEqual({ granted_at: "fica" });
    expect(merged.marketing).toMatchObject({ granted_at: "agora", source: "api", version: "v1", declined_at: null });
  });

  it("grava o carimbo no contato da organização", async () => {
    let gravado: unknown = null;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { consent: { profiling: { source: "antes" } } }, error: null }),
            }),
          }),
        }),
        update: (patch: { consent: unknown }) => {
          gravado = patch.consent;
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      }),
    };
    await registrarConsentimento(db as never, {
      organizationId: "org",
      contactId: "contato",
      canal: "whatsapp",
      fuente: "api",
      version: "v1",
      grantedAt: "2026-10-23T00:00:00.000Z",
    });
    expect(gravado).toMatchObject({
      profiling: { source: "antes" },
      marketing: { granted_at: "2026-10-23T00:00:00.000Z", source: "api", channel: "whatsapp", declined_at: null },
    });
  });
});

describe("janela e opt-out antes do envio", () => {
  it("texto livre só é recusado no canal oficial com janela fechada", () => {
    const agora = new Date("2026-10-23T12:00:00.000Z");
    expect(textoLivreForaDaJanela("waha", null, agora)).toBe(false);
    expect(textoLivreForaDaJanela("zernio", null, agora)).toBe(false);
    expect(textoLivreForaDaJanela("meta_cloud", null, agora)).toBe(true);
    expect(textoLivreForaDaJanela("meta_cloud", "2026-10-22T00:00:00.000Z", agora)).toBe(true);
    expect(textoLivreForaDaJanela("meta_cloud", "2026-10-23T11:00:00.000Z", agora)).toBe(false);
  });

  it("contato bloqueado não passa da guarda nem do agente", () => {
    const guarda = checarGuardasDeContato({
      context: { contact: { id: "c", is_blocked: true, phone_number: EC } },
    } as unknown as ActionCtx);
    expect(guarda).toEqual({ ok: false, reason: "contact_blocked" });

    const semPergunta = checarGuardasDeContato({
      context: { contact: { id: "c", is_blocked: false, phone_number: EC, consent: { marketing: { granted_at: null } } } },
    } as unknown as ActionCtx);
    expect(semPergunta.ok).toBe(true);

    const veto = evaluateBeforeSend({
      now: new Date(),
      body: "oi",
      optedOut: true,
      provider: "meta_cloud",
    } as GateContext);
    expect(veto.veto?.code).toBe("contato_bloqueado");
  });
});

describe("telefone em log", () => {
  it("mascara o meio e o redator não deixa o E.164 inteiro", () => {
    expect(maskPhone(EC)).toBe("+593******567");
    const sujo = `falha no contato ${EC}`;
    expect(redactPhones(sujo)).not.toContain("593991234567");
    expect(redactPhones(sujo)).toContain("567");
  });
});

describe("rede", () => {
  it("chamada à Graph sem mock é recusada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede_nao_mockada");
      }),
    );
    await expect(
      sendTemplate({
        phoneNumberId: "TEST_PHONE_NUMBER_ID",
        token: "tok-de-teste",
        graphVersion: "v22.0",
        to: "593991234567",
        binding: { name: "rb_aviso", language: "es", contractHash: "h", values: {} },
        current: {
          name: "rb_aviso",
          language: "es",
          contractHash: "h",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Hola" }],
        },
      }),
    ).rejects.toThrow(/rede_nao_mockada/);
  });
});

describe("comparação de segredo não imprime o token", () => {
  it("o prefixo do hash distingue dois tokens", () => {
    const hash = (valor: string) => createHash("sha256").update(valor).digest("hex").slice(0, 12);
    expect(hash("token-a")).not.toBe(hash("token-b"));
  });
});
