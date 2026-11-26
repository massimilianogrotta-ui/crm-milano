import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Duas organizações, duas sessões. O teste olha o hash do header, não o token:
 * um diff do Vitest não pode imprimir segredo.
 */
const POR_ORG: Record<string, { phone: string; token: string; cifra: string }> = {
  "org-a": { phone: "TEST_PHONE_NUMBER_ID_A", token: "token-org-a", cifra: "aaa" },
  "org-b": { phone: "TEST_PHONE_NUMBER_ID_B", token: "token-org-b", cifra: "bbb" },
};

const TEMPLATE = {
  name: "rb_aviso",
  language: "es",
  status: "APPROVED",
  contract_hash: "h",
  components: [{ type: "BODY", text: "Hola" }],
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filtros: Record<string, string> = {};
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: (coluna: string, valor: string) => {
          filtros[coluna] = valor;
          return cadeia;
        },
        is: () => cadeia,
        maybeSingle: async () => {
          if (table === "meta_templates") return { data: TEMPLATE, error: null };
          const linha = POR_ORG[filtros.organization_id ?? ""];
          if (!linha || linha.phone !== filtros.meta_phone_number_id) return { data: null, error: null };
          return { data: { meta_phone_number_id: linha.phone, meta_token_encrypted: linha.cifra }, error: null };
        },
      };
      return cadeia;
    },
    rpc: async (_nome: string, args: { ciphertext: string }) => {
      const linha = Object.values(POR_ORG).find((item) => args.ciphertext.includes(item.cifra));
      return { data: linha?.token ?? null, error: null };
    },
  }),
}));

import { getAdapter } from "@/lib/channels";

function hash(valor: string): string {
  return createHash("sha256").update(valor).digest("hex").slice(0, 16);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("credencial por organização", () => {
  it("cada envio usa o phone_number_id e o token da própria sessão", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "");
    vi.stubEnv("META_SYSTEM_USER_TOKEN", "");
    vi.stubEnv("META_GRAPH_VERSION", "v22.0");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.OK" }] }),
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = getAdapter("meta_cloud");
    await adapter.sendTemplate?.({
      organizationId: "org-a",
      sessionRef: "TEST_PHONE_NUMBER_ID_A",
      to: "593991234567",
      name: "rb_aviso",
      language: "es",
      values: {},
    });
    await adapter.sendTemplate?.({
      organizationId: "org-b",
      sessionRef: "TEST_PHONE_NUMBER_ID_B",
      to: "593991234567",
      name: "rb_aviso",
      language: "es",
      values: {},
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const auths = fetchMock.mock.calls.map((c) => {
      const headers = c[1]?.headers as { Authorization?: string } | undefined;
      return hash(String(headers?.Authorization ?? ""));
    });
    expect(urls[0]).toContain("TEST_PHONE_NUMBER_ID_A");
    expect(urls[0]).not.toContain("TEST_PHONE_NUMBER_ID_B");
    expect(urls[1]).toContain("TEST_PHONE_NUMBER_ID_B");
    expect(auths[0]).toBe(hash("Bearer token-org-a"));
    expect(auths[1]).toBe(hash("Bearer token-org-b"));
    expect(auths[0]).not.toBe(auths[1]);
  });
});
