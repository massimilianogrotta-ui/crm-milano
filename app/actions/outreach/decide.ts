"use server";

import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type ActiveOrg, type AuthUser } from "@/lib/auth/types";
import { sendEmail } from "@/lib/email/resend";
import { supportWriteError } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { isOutreachDryRun } from "@/lib/outreach/config";
import { eseguiDecisione } from "@/lib/outreach/execute";
import { spostaInAttesa } from "@/lib/outreach/move-to-waiting";
import { createClient } from "@/lib/supabase/server";

/**
 * Agente outreach All-io (P0): le decisioni umane sulla coda "Da approvare".
 * Nessun invio parte da qui senza il clic di un umano con ruolo `agent` in su —
 * il worker genera solo bozze `pending` (`lib/outreach/generate.ts`).
 */
type Risultato = { ok: true; status: string } | { ok: false; error: string };

/** Autenticazione + tenant + RBAC (`agent` in su), con discriminante esplicita:
 * il narrowing letterale `!ctx.ok` è affidabile dove `"error" in ctx` non lo è. */
type Contesto = { ok: false; error: string } | { ok: true; user: AuthUser; org: ActiveOrg };

async function contesto(): Promise<Contesto> {
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.agent) return { ok: false, error: "forbidden_role" };
  return { ok: true, user, org };
}

export async function decidiProposta(id: string, azione: "approva" | "rifiuta"): Promise<Risultato> {
  // Server action = endpoint pubblico: il valore arriva dal client e va
  // verificato qui, altrimenti qualsiasi stringa diversa da "rifiuta" approva.
  if (azione !== "approva" && azione !== "rifiuta") return { ok: false, error: "validation_failed" };
  const ctx = await contesto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("outreach_proposals")
    .select("id, organization_id, lead_id, contact_id, kind, status, to_address, subject, body, contacts(is_blocked)")
    .eq("id", id)
    .eq("organization_id", ctx.org.orgId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const contatto = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as { is_blocked: boolean } | null;

  const r = await eseguiDecisione(
    {
      id: row.id, organizationId: row.organization_id, leadId: row.lead_id, contactId: row.contact_id,
      kind: row.kind, status: row.status, toAddress: row.to_address, subject: row.subject, body: row.body,
      contactBlocked: contatto?.is_blocked ?? false,
    },
    { azione, userId: ctx.user.id },
    {
      dryRun: isOutreachDryRun(),
      send: (a) => sendEmail({ ...a, fromName: "Max · All-io" }),
      salva: async ({ expectStatus, ...patch }) => {
        const { data } = await supabase
          .from("outreach_proposals")
          .update(patch)
          .eq("id", row.id)
          .eq("status", expectStatus)
          .select("id");
        return (data ?? []).length > 0;
      },
      spostaInAttesa: () =>
        spostaInAttesa(supabase, { organizationId: ctx.org.orgId, leadId: row.lead_id, contactId: row.contact_id, userId: ctx.user.id }),
      nota: async (testo) => {
        await emitLeadActivity(supabase, {
          organizationId: ctx.org.orgId, leadId: row.lead_id, contactId: row.contact_id,
          type: "note", sourceModule: "outreach", sourceId: row.id,
          actor: { type: "user", id: ctx.user.id }, reason: testo, payload: { proposal_id: row.id },
        });
      },
    },
  );
  revalidatePath("/app/outreach");
  return r.status === "failed" ? { ok: false, error: r.errore ?? "send_failed" } : { ok: true, status: r.status };
}

export async function modificaProposta(id: string, subject: string, body: string): Promise<Risultato> {
  const ctx = await contesto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const s = subject.trim().slice(0, 200);
  const b = body.trim().slice(0, 5000);
  if (!s || !b) return { ok: false, error: "validation_failed" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_proposals")
    .update({ subject: s, body: b })
    .eq("id", id)
    .eq("organization_id", ctx.org.orgId)
    .eq("status", "pending")
    .select("id");
  revalidatePath("/app/outreach");
  return (data ?? []).length > 0 ? { ok: true, status: "pending" } : { ok: false, error: "non_pending" };
}