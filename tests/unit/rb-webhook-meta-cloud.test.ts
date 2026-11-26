import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SESSAO = { id: "sess-1", organizationId: "org-do-token", wabaId: "WABA_TEST", phoneNumberId: "TEST_PHONE_NUMBER_ID" };
const APP_SECRET = "app-secret-de-teste";
const TOKEN = "token-de-teste-valido";

const updates: { table: string; patch: Record<string, unknown>; filtros: [string, unknown][] }[] = [];

vi.mock("@/lib/channels/meta/session", () => ({
  metaSessionByWebhookToken: async (token: string) => (token === TOKEN ? SESSAO : null),
}));

vi.mock("@/lib/channels/meta/ingest", () => ({
  ingestMetaInbound: async () => ({ status: "failed", reason: "contato +593991234567 recusado" }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const filtros: [string, unknown][] = [];
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return cadeia;
          },
          in: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            updates.push({ table, patch, filtros });
            return cadeia;
          },
        };
        return cadeia;
      },
    }),
  }),
}));

import { GET, POST } from "@/app/api/v1/webhooks/meta/[token]/route";

const ctx = { params: Promise.resolve({ token: TOKEN }) };

function assinado(corpo: unknown, segredo = APP_SECRET, alterar = false) {
  const cru = JSON.stringify(corpo);
  const hex = createHmac("sha256", segredo).update(cru, "utf8").digest("hex");
  return new NextRequest("http://localhost/api/v1/webhooks/meta/" + TOKEN, {
    method: "POST",
    body: alterar ? `${cru} ` : cru,
    headers: { "x-hub-signature-256": `sha256=${hex}`, "content-type": "application/json" },
  });
}

function statusPayload(status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "TEST_PHONE_NUMBER_ID" },
              statuses: [{ id: "wamid.STATUS", status, timestamp: "1", recipient_id: "593991234567" }],
            },
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  updates.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handshake e assinatura", () => {
  it("token certo devolve o challenge em texto puro; token errado devolve 403", async () => {
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-de-teste");
    const certo = new NextRequest(
      `http://localhost/api/v1/webhooks/meta/${TOKEN}?hub.mode=subscribe&hub.verify_token=verify-de-teste&hub.challenge=CHALLENGE_OK`,
    );
    const ok = await GET(certo, ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/plain");
    expect(await ok.text()).toBe("CHALLENGE_OK");

    const errado = new NextRequest(
      `http://localhost/api/v1/webhooks/meta/${TOKEN}?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=CHALLENGE_OK`,
    );
    expect((await GET(errado, ctx)).status).toBe(403);
  });

  it("POST com HMAC válido entra; corpo alterado ou sem assinatura volta 401", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    const corpo = statusPayload("delivered");
    expect((await POST(assinado(corpo), ctx)).status).toBe(200);

    expect((await POST(assinado(corpo, APP_SECRET, true), ctx)).status).toBe(401);

    const sem = new NextRequest("http://localhost/api/v1/webhooks/meta/" + TOKEN, {
      method: "POST",
      body: JSON.stringify(corpo),
    });
    expect((await POST(sem, ctx)).status).toBe(401);
  });
});

describe("status entregue e lido", () => {
  it("grava delivered e read, e o filtro não deixa a leitura voltar", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    expect((await POST(assinado(statusPayload("delivered")), ctx)).status).toBe(200);
    expect((await POST(assinado(statusPayload("read")), ctx)).status).toBe(200);

    const entregue = updates.find((u) => u.patch.status === "delivered");
    const lido = updates.find((u) => u.patch.status === "read");
    expect(entregue?.patch.delivered_at).toEqual(expect.any(String));
    expect(lido?.filtros).toEqual(expect.arrayContaining([["status", expect.arrayContaining(["sent", "delivered"])]]));
    const anterioresDoRead = lido?.filtros.find((f) => Array.isArray(f) && f[0] === "status")?.[1] as string[];
    expect(anterioresDoRead).not.toContain("read");
    expect(updates.every((u) => u.filtros.some((f) => Array.isArray(f) && f[0] === "organization_id" && f[1] === "org-do-token"))).toBe(true);
  });
});

describe("log do webhook", () => {
  it("falha de ingestão não grava o telefone inteiro", async () => {
    vi.stubEnv("META_APP_SECRET", APP_SECRET);
    const erros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      erros.push(args.map((a) => String(a)).join(" "));
    });
    const corpo = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TEST",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "TEST_PHONE_NUMBER_ID" },
                messages: [
                  {
                    id: "wamid.IN",
                    from: "593991234567",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect((await POST(assinado(corpo), ctx)).status).toBe(200);
    const texto = erros.join("\n");
    expect(texto).not.toContain("593991234567");
    expect(texto).toContain("+593******567");
    expect(texto).not.toContain("TEST_PHONE_NUMBER_ID");
  });
});
