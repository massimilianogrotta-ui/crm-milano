import { afterEach, describe, expect, it, vi } from "vitest";

import { validateAnthropicKey, validateOpenRouterKey } from "@/lib/ai/provider-validators";

/**
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O validador da OpenRouter chamava `/api/v1/models`, que é PÚBLICO: ele
 * responde 200 sem header nenhum. Qualquer string era gravada como credencial
 * validada, e a falha só aparecia no primeiro turno do agente — como
 * `runtime_error: User not found.`, mensagem que não fala de credencial.
 *
 * O caso decisivo é o último: ele prende o ENDEREÇO da primeira chamada. Sem
 * ele, alguém "simplifica" o validador de volta para uma requisição só, o
 * catálogo responde 200 para chave falsa, e os dois primeiros casos aqui
 * continuariam verdes — a família do teste que concorda com o próprio defeito.
 */

const chamadas: string[] = [];

function fetchFalso(respostas: Record<string, { status: number; body?: unknown }>) {
  return vi.fn(async (url: string) => {
    chamadas.push(url);
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    const r = chave ? respostas[chave]! : { status: 404 };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as unknown as Response;
  });
}

afterEach(() => {
  chamadas.length = 0;
  vi.unstubAllGlobals();
});

describe("validateAnthropicKey", () => {
  it("recusa 401 da API de mensagens mesmo quando o catálogo responde 200", async () => {
    vi.stubGlobal("fetch", fetchFalso({ "/v1/messages": { status: 401 }, "/v1/models": { status: 200, body: { data: [{ id: "claude-haiku-4-5" }] } } }));
    expect(await validateAnthropicKey("sk-ant-invalida")).toEqual({ ok: false, error: "auth_failed_401" });
    expect(chamadas).toEqual(["https://api.anthropic.com/v1/models", "https://api.anthropic.com/v1/messages"]);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.headers).toMatchObject({ "x-api-key": "sk-ant-invalida" });
  });

  it("aceita a chave quando a chamada real funciona", async () => {
    vi.stubGlobal("fetch", fetchFalso({ "/v1/messages": { status: 200 }, "/v1/models": { status: 200, body: { data: [{ id: "claude-haiku-4-5" }] } } }));
    expect(await validateAnthropicKey("sk-ant-valida")).toEqual({ ok: true, models: ["claude-haiku-4-5"] });
  });

  it("marca 403 da API de mensagens como inválida", async () => {
    vi.stubGlobal("fetch", fetchFalso({ "/v1/messages": { status: 403 }, "/v1/models": { status: 200, body: { data: [{ id: "claude-haiku-4-5" }] } } }));
    expect(await validateAnthropicKey("sk-ant-recusada")).toEqual({ ok: false, error: "auth_failed_401" });
  });
});

describe("validateOpenRouterKey", () => {
  it("recusa a chave que a OpenRouter não reconhece", async () => {
    // Era ESTE o caso que passava: /api/v1/models devolve 200 para qualquer um.
    vi.stubGlobal(
      "fetch",
      fetchFalso({ "/api/v1/key": { status: 401 }, "/api/v1/models": { status: 200 } }),
    );
    const r = await validateOpenRouterKey("sk-or-v1-nao-existe");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe("auth_failed_401");
  });

  it("aceita a chave boa e devolve o catálogo", async () => {
    vi.stubGlobal(
      "fetch",
      fetchFalso({
        "/api/v1/key": { status: 200, body: { data: { label: "x" } } },
        "/api/v1/models": { status: 200, body: { data: [{ id: "minimax/minimax-m3:free" }] } },
      }),
    );
    const r = await validateOpenRouterKey("sk-or-v1-boa");
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.models).toEqual(["minimax/minimax-m3:free"]);
  });

  it("catálogo fora do ar não recusa chave que já provou ser válida", async () => {
    // Trocar erro de credencial por erro de disponibilidade faria o operador
    // caçar defeito na chave certa.
    vi.stubGlobal(
      "fetch",
      fetchFalso({ "/api/v1/key": { status: 200 }, "/api/v1/models": { status: 503 } }),
    );
    const r = await validateOpenRouterKey("sk-or-v1-boa");
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.models).toEqual([]);
  });

  it("a PROVA é o endpoint autenticado, e é o primeiro a ser chamado", async () => {
    vi.stubGlobal(
      "fetch",
      fetchFalso({ "/api/v1/key": { status: 200 }, "/api/v1/models": { status: 200 } }),
    );
    await validateOpenRouterKey("sk-or-v1-boa");
    expect(chamadas[0]).toContain("/api/v1/key");
  });
});
