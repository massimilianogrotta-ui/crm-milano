// A AÇÃO que grava a política de segundo fator (upstream #2163, adaptado ao
// fork, onde a ação recebe só um booleano): entrada malformada é RECUSADA em
// vez de gravada e auditada como se fosse uma escolha.
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  role: "admin" as string,
  settings: {} as Record<string, unknown>,
  updates: [] as unknown[],
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: () => null }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: Record<string, unknown>) => {
    estado.audits.push(e);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "u1", is_platform_admin: false, support: null }),
  resolveActiveOrg: async () => ({ orgId: "o1", role: estado.role }),
  sessionAal: async () => "aal2",
  isMfaEnrolled: async () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { settings: estado.settings }, error: null }) }),
      }),
      update: (v: unknown) => ({
        eq: async () => {
          estado.updates.push(v);
          return { error: null };
        },
      }),
    }),
  }),
}));

import { definirExigenciaDeMfa } from "@/app/actions/auth/politicaDeMfa";

beforeEach(() => {
  estado.role = "admin";
  estado.settings = {};
  estado.updates = [];
  estado.audits = [];
});

describe("definirExigenciaDeMfa — entrada malformada", () => {
  it("quem não é admin é recusado e nada é gravado", async () => {
    estado.role = "manager";
    const r = await definirExigenciaDeMfa(true);
    expect(r.ok).toBe(false);
    expect(estado.updates).toHaveLength(0);
  });

  it.each(["admin", 1, null, { minRole: "agent" }])(
    "entrada %j não é boolean: recusada, nada gravado nem auditado",
    async (entrada) => {
      estado.settings = { security: { mfa_required: true } };
      const r = await definirExigenciaDeMfa(entrada as never);
      expect(r.ok).toBe(false);
      expect(estado.updates).toHaveLength(0);
      expect(estado.audits).toHaveLength(0);
    },
  );

  it("booleano válido grava e audita", async () => {
    const r = await definirExigenciaDeMfa(true);
    expect(r.ok).toBe(true);
    const sec = (estado.updates[0] as { settings: { security: Record<string, unknown> } }).settings.security;
    expect(sec.mfa_required).toBe(true);
    expect(estado.audits[0]?.action).toBe("security.mfa_exigida");
  });
});
