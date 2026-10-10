import { sendEmail } from "@/lib/email/resend";
import { mittenteOutreach } from "@/lib/outreach/config";

export function inviaEmailOutreach(
  args: { to: string; subject: string; text: string; html: string },
  sender = mittenteOutreach(),
) {
  return sendEmail({ ...args, ...sender });
}
