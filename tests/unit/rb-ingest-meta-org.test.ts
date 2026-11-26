import { describe, expect, it, vi } from "vitest";

import type { InboundMessageEvent } from "@/lib/channels/meta/webhook";

vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: async () => {},
}));

import { ingestMetaInbound } from "@/lib/channels/meta/ingest";

const ORG = "org-do-token";
const OUTRA = "org-alheia";
const rpc: { nome: string; args: Record<string, unknown> }[] = [];

function adminPara(orgDaSessao: string) {
  return {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return cadeia;
        },
        is: () => cadeia,
        in: () => cadeia,
        limit: async () => ({ data: [], error: null }),
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "msg-1" }, error: null }) }) }),
        maybeSingle: async () => {
          if (table !== "channel_sessions") return { data: null, error: null };
          if (filtros.organization_id !== orgDaSessao) return { data: null, error: null };
          return { data: { id: "sess-1", organization_id: orgDaSessao }, error: null };
        },
      };
      return cadeia;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpc.push({ nome, args });
      if (nome === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (nome === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
}

function evento(): InboundMessageEvent {
  return {
    kind: "inbound_message",
    wabaId: "WABA_TEST",
    phoneNumberId: "TEST_PHONE_NUMBER_ID",
    externalId: "wamid.EC",
    from: "593991234567",
    profileName: "Produtor",
    sentAt: new Date("2026-10-23T12:00:00.000Z"),
    type: "text",
    text: "hola",
    media: null,
  };
}

describe("ingestão do número equatoriano", () => {
  it("cria o contato +593 na organização do token, e não na outra", async () => {
    rpc.length = 0;
    const ok = await ingestMetaInbound(adminPara(ORG) as never, evento(), { organizationId: ORG });
    expect(ok.status).toBe("ingested");
    const contato = rpc.find((c) => c.nome === "fn_upsert_wa_contact");
    expect(contato?.args.p_org).toBe(ORG);
    expect(contato?.args.p_phone).toBe("+593991234567");

    const antes = rpc.length;
    const alheio = await ingestMetaInbound(adminPara(ORG) as never, evento(), { organizationId: OUTRA });
    expect(alheio.status).toBe("no_session");
    expect(rpc.slice(antes).some((c) => c.args.p_org === OUTRA)).toBe(false);
  });
});
