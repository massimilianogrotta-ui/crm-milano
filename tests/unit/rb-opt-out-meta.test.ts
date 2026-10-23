import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  settings: { phone_default_country: "EC" } as Record<string, unknown>,
  lastInbound: null as string | null,
  alreadyBlocked: false,
  phone: "+593991234567",
  log: [] as { table: string; op: string; patch?: unknown; row?: unknown }[],
};

function cliente() {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        is: () => api,
        in: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          if (table === "organizations") return { data: { settings: estado.settings }, error: null };
          if (table === "conversations") {
            return { data: { last_inbound_at: estado.lastInbound, channel_session_id: "sess-1" }, error: null };
          }
          if (table === "channel_sessions") {
            return {
              data: {
                provider: "meta_cloud",
                meta_phone_number_id: "TEST_PHONE_NUMBER_ID",
                status: "WORKING",
                metadata: {},
              },
              error: null,
            };
          }
          if (table === "contacts") {
            return { data: { phone_number: estado.phone, is_blocked: estado.alreadyBlocked, ai_authorized_at: null }, error: null };
          }
          return { data: null, error: null };
        },
        update: (patch: unknown) => {
          estado.log.push({ table, op: "update", patch });
          return api;
        },
        insert: (row: unknown) => {
          estado.log.push({ table, op: "insert", row });
          return api;
        },
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        is: () => api,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/leads/nascimento-do-lead", () => ({
  garantirLeadDaConversa: async () => ({ criado: false, motivo: "teste" }),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ acelerarPipelineDeEventos: () => {} }));

import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";

const entrada = (texto: string) => ({
  organizationId: "org-ec",
  contactId: "contato-1",
  conversationId: "conversa-1",
  messageId: "msg-1",
  channelSessionId: "sess-1",
  texto,
  nomeDoContato: "Produtor",
  origem: "meta_webhook",
});

function bloqueou(): boolean {
  return estado.log.some(
    (l) => l.table === "contacts" && l.op === "update" && (l.patch as { is_blocked?: boolean }).is_blocked === true,
  );
}

beforeEach(() => {
  estado.settings = { phone_default_country: "EC" };
  estado.lastInbound = null;
  estado.alreadyBlocked = false;
  estado.log = [];
  vi.stubEnv("META_PHONE_NUMBER_ID", "TEST_PHONE_NUMBER_ID");
  vi.stubEnv("META_SYSTEM_USER_TOKEN", "tok-de-teste");
  vi.stubEnv("META_GRAPH_VERSION", "v22.0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("opt-out no canal oficial", () => {
  it.each(["BAJA", "STOP", "salir"])("%s bloqueia o contato", async (texto) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await aplicarEfeitosPosEntrada(cliente() as never, entrada(texto));
    expect(bloqueou()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("com a janela aberta e país EC confirma em espanhol antes do bloqueio", async () => {
    estado.lastInbound = new Date().toISOString();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.BAJA" }] }),
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    await aplicarEfeitosPosEntrada(cliente() as never, entrada("BAJA"));
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    const corpo = JSON.parse(String(init?.body)) as { text: { body: string } };
    expect(corpo.text.body).toContain("No te enviaremos");
    expect(bloqueou()).toBe(true);
    expect(estado.log.some((l) => l.table === "messages" && l.op === "insert")).toBe(true);
    const bloqueio = estado.log.findIndex((l) => l.table === "contacts" && l.op === "update");
    const envio = fetchMock.mock.invocationCallOrder[0] ?? 0;
    expect(bloqueio).toBeGreaterThanOrEqual(0);
    expect(envio).toBeGreaterThan(0);
  });

  it("organização brasileira não recebe a frase em espanhol", async () => {
    estado.settings = {};
    estado.lastInbound = new Date().toISOString();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await aplicarEfeitosPosEntrada(cliente() as never, entrada("STOP"));
    expect(bloqueou()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
