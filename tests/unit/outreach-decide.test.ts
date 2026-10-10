import { describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true, id: "email-1" })) }));
vi.mock("@/lib/email/resend", () => ({ sendEmail }));

import { inviaEmailOutreach } from "@/app/actions/outreach/send-email";

describe("invio email outreach", () => {
  it("passa mittente e reply-to dedicati al trasporto", async () => {
    const args = { to: "lead@example.it", subject: "Demo", text: "Buongiorno", html: "<p>Buongiorno</p>" };
    await inviaEmailOutreach(args, { fromName: "Max · All-io", fromEmail: "max@example.it", replyTo: "reply@example.it" });
    expect(sendEmail).toHaveBeenCalledWith({ ...args, fromName: "Max · All-io", fromEmail: "max@example.it", replyTo: "reply@example.it" });
  });
});
