import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

const espelho: { template: Record<string, unknown> | null; settings: Record<string, unknown>; consent: unknown } = {
  template: null,
  settings: {},
  consent: {},
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const cadeia: Record<string, unknown> = {};
      const fim = async () =>
        table === "meta_templates" ? { data: espelho.template, error: null } : { data: null, error: null };
      cadeia.select = () => cadeia;
      cadeia.eq = () => cadeia;
      cadeia.is = () => cadeia;
      cadeia.in = () => cadeia;
      cadeia.maybeSingle = fim;
      return { select: () => cadeia };
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

function supabase(over: { blocked?: boolean; provider?: string; lastInbound?: string | null } = {}) {
  const state: { message: Record<string, unknown> | null } = { message: null };
  const client = {
    from(table: string) {
      if (table === "conversations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: CONV,
                  organization_id: ORG,
                  contact_id: CONTACT,
                  channel_session_id: SESSION,
                  is_group: false,
                  group_chat_id: null,
                  provider_conversation_id: null,
                  last_inbound_at: over.lastInbound === undefined ? null : over.lastInbound,
                  contacts: {
                    phone_number: "+593991234567",
                    wa_identity: null,
                    is_blocked: over.blocked ?? false,
                  },
                  channel_sessions: {
                    provider: over.provider ?? "meta_cloud",
                    waha_session_name: null,
                    meta_phone_number_id: "TEST_PHONE_NUMBER_ID",
                    zernio_account_id: null,
                    status: "WORKING",
                    archived_at: null,
                  },
                },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "messages") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.message = { id: "msg-1", external_id: null, ack: null, error_code: null, error_message: null, metadata: {}, ...row };
            return { select: () => ({ single: async () => ({ data: { ...state.message }, error: null }) }) };
          },
          update: (patch: Record<string, unknown>) => {
            state.message = { ...state.message, ...patch };
            const q: Record<string, unknown> = {
              eq: () => q,
              select: () => q,
              maybeSingle: async () => ({ data: { ...state.message }, error: null }),
              single: async () => ({ data: { ...state.message }, error: null }),
            };
            return q;
          },
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: state.message, error: null }) }) }) }) }),
        };
      }
      if (table === "organizations") {
        const q: Record<string, unknown> = {
          eq: () => q,
          maybeSingle: async () => ({ data: { settings: espelho.settings }, error: null }),
        };
        return { select: () => q };
      }
      if (table === "meta_templates") {
        const q: Record<string, unknown> = {
          eq: () => q,
          maybeSingle: async () => ({ data: espelho.template, error: null }),
        };
        return { select: () => q };
      }
      if (table === "contacts") {
        const q: Record<string, unknown> = {
          eq: () => q,
          then: (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
          maybeSingle: async () => ({ data: { consent: espelho.consent }, error: null }),
        };
        return { select: () => q, update: () => q };
      }
      throw new Error(`tabela inesperada ${table}`);
    },
    rpc: async () => ({ error: null }),
  };
  return client as unknown as SupabaseClient;
}

const ctx: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "req-1" };

function texto(): SendMessageInput {
  return { conversation_id: CONV, type: "text", body: "hola" } as SendMessageInput;
}

function modelo(): SendMessageInput {
  return {
    conversation_id: CONV,
    type: "template",
    template_name: "rb_precio_semanal",
    template_language: "es",
    template_values: { "1": "Ana" },
  } as SendMessageInput;
}

const TEMPLATE = {
  name: "rb_precio_semanal",
  language: "es",
  status: "APPROVED",
  contract_hash: "h",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hola {{1}}" }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  espelho.template = null;
  espelho.settings = {};
  espelho.consent = {};
});

function credenciais() {
  vi.stubEnv("META_PHONE_NUMBER_ID", "TEST_PHONE_NUMBER_ID");
  vi.stubEnv("META_SYSTEM_USER_TOKEN", "tok-de-teste");
  vi.stubEnv("META_GRAPH_VERSION", "v22.0");
  vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
  vi.stubEnv("WAHA_API_KEY", "hash");
}

describe("envio recusado", () => {
  it("contato bloqueado não dispara texto nem modelo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMessageHandler(supabase({ blocked: true, provider: "waha" }), ctx, texto())).rejects.toMatchObject({
      status: 403,
    });
    await expect(sendMessageHandler(supabase({ blocked: true, provider: "waha" }), ctx, modelo())).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("janela fechada, nula ou vencida recusa texto livre no canal oficial", async () => {
    credenciais();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMessageHandler(supabase({ lastInbound: null }), ctx, texto())).rejects.toMatchObject({
      status: 403,
      code: "fuera_de_ventana",
    });
    await expect(
      sendMessageHandler(supabase({ lastInbound: "2020-01-01T00:00:00.000Z" }), ctx, texto()),
    ).rejects.toMatchObject({ code: "fuera_de_ventana" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("janela aberta deixa o texto sair", async () => {
    credenciais();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.OK" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const msg = await sendMessageHandler(supabase({ lastInbound: new Date().toISOString() }), ctx, texto());
    expect(msg.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("marketing sem consentimento é 403; utilidade segue", async () => {
    credenciais();
    espelho.settings = { require_marketing_consent: true };
    espelho.template = { ...TEMPLATE, category: "MARKETING" };
    espelho.consent = { marketing: { granted_at: null } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.TPL" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessageHandler(supabase({ lastInbound: null }), ctx, modelo())).rejects.toMatchObject({
      status: 403,
      code: "marketing_consent_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    espelho.template = { ...TEMPLATE, category: "UTILITY" };
    const msg = await sendMessageHandler(supabase({ lastInbound: null }), ctx, modelo());
    expect(msg.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalled();
  });
});
