import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eseguiDecisione: vi.fn(async () => ({ status: "sent" })),
  sendMessageHandler: vi.fn(),
  row: {
    id: "proposal-1", organization_id: "org-1", lead_id: "lead-1", contact_id: "contact-1",
    channel: "wa", kind: "followup", status: "pending", to_address: "+393331234567",
    subject: null, body: "Test", contacts: { is_blocked: false, phone_number: "+393331234567" },
  },
}));

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "user-1", is_platform_admin: true, support: null }),
  resolveActiveOrg: async () => ({ orgId: "org-1", role: "admin" }),
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row }) }) }) }) }),
}) }));
vi.mock("@/lib/outreach/config", () => ({ isOutreachDryRun: () => true }));
vi.mock("@/lib/outreach/execute", () => ({ eseguiDecisione: mocks.eseguiDecisione }));
vi.mock("@/lib/automation/start-conversation", () => ({ sessaoProntaParaEnvio: vi.fn(), ensureConversation: vi.fn() }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: mocks.sendMessageHandler }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { decidiProposta } from "@/app/actions/outreach/decide";

beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("approvazione follow-up WhatsApp", () => {
  it.each([
    ["inverno", "2026-01-10T07:59:00Z"],
    ["estate", "2026-07-10T06:59:00Z"],
    ["dopo le 19", "2026-07-10T17:00:00Z"],
  ])("fuori finestra %s: non invia e lascia la bozza pending", async (_, now) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    expect(await decidiProposta("proposal-1", "approva")).toEqual({ ok: false, error: "fuori_orario" });
    expect(mocks.eseguiDecisione).not.toHaveBeenCalled();
    expect(mocks.sendMessageHandler).not.toHaveBeenCalled();
    expect(mocks.row.status).toBe("pending");
  });

  it.each(["2026-01-10T08:00:00Z", "2026-07-10T16:59:00Z"])(
    "nella finestra Roma %s: procede", async (now) => {
      vi.useFakeTimers(); vi.setSystemTime(new Date(now));
      expect(await decidiProposta("proposal-1", "approva")).toEqual({ ok: true, status: "sent" });
      expect(mocks.eseguiDecisione).toHaveBeenCalledOnce();
    },
  );
});
