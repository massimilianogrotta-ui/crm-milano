"use server";

import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type ActiveOrg, type AuthUser } from "@/lib/auth/types";
import { giornataRoma } from "@/lib/outreach/day";
import { bloccaOutreach } from "@/lib/outreach/lock";
import { cellulareItaliano } from "@/lib/outreach/select";
import { sessaoProntaParaEnvio, ensureConversation } from "@/lib/automation/start-conversation";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { supportWriteError } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { isOutreachDryRun } from "@/lib/outreach/config";
import { eseguiDecisione } from "@/lib/outreach/execute";
import { spostaInAttesa } from "@/lib/outreach/move-to-waiting";
import { createClient } from "@/lib/supabase/server";
import { inviaEmailOutreach } from "./send-email";

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
    .select("id, organization_id, lead_id, contact_id, channel, kind, status, to_address, subject, body, contacts(is_blocked, phone_number)")
    .eq("id", id)
    .eq("organization_id", ctx.org.orgId)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const contatto = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as { is_blocked: boolean; phone_number: string | null } | null;
  if (azione === "approva" && row.channel === "wa" &&
      (!row.contact_id || cellulareItaliano(contatto?.phone_number ?? null) !== row.to_address)) {
    return { ok: false, error: "invalid_phone" };
  }

  let libera: (() => Promise<void>) | null = null;
  if (azione === "approva" && !isOutreachDryRun()) {
    try { libera = await bloccaOutreach(ctx.org.orgId); }
    catch { return { ok: false, error: "outreach_lock_unavailable" }; }
    if (!libera) return { ok: false, error: "outreach_busy" };
  }
  try {
  const r = await eseguiDecisione(
    {
      id: row.id, organizationId: row.organization_id, leadId: row.lead_id, contactId: row.contact_id,
      kind: row.kind, channel: row.channel, status: row.status, toAddress: row.to_address, subject: row.subject, body: row.body,
      contactBlocked: contatto?.is_blocked ?? false,
    },
    { azione, userId: ctx.user.id },
    {
      dryRun: isOutreachDryRun(),
      contaInviiVeri: async () => {
        const { inizio, fine } = giornataRoma(new Date());
        const [inviati, prenotati] = await Promise.all([
          supabase.from("outreach_proposals").select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.org.orgId).eq("status", "sent").eq("dry_run", false)
            .gte("sent_at", inizio).lt("sent_at", fine),
          supabase.from("outreach_proposals").select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.org.orgId).eq("status", "approved").eq("dry_run", false)
            .gte("decided_at", inizio).lt("decided_at", fine),
        ]);
        if (inviati.error || prenotati.error || inviati.count === null || prenotati.count === null) {
          throw new Error(inviati.error?.message ?? prenotati.error?.message ?? "count_failed");
        }
        return inviati.count + prenotati.count;
      },
      send: async (a) => {
        if (row.channel === "email") return inviaEmailOutreach(a);
        try {
          const admin = createAdminClient();
          // Il trasporto legge contacts.phone_number per costruire il destinatario.
          // Canonicalizzare solo il numero ancora uguale a quello approvato evita
          // che 0039/3xx diventino chat ID senza prefisso internazionale.
          if (contatto?.phone_number !== row.to_address) {
            const { data: aggiornato, error: ePhone } = await admin.from("contacts")
              .update({ phone_number: row.to_address })
              .eq("organization_id", ctx.org.orgId).eq("id", row.contact_id)
              .eq("phone_number", contatto?.phone_number ?? "")
              .eq("is_blocked", false).select("id").maybeSingle();
            if (ePhone || !aggiornato) return { ok: false, error: "invalid_phone" };
          }
          const sessionId = await sessaoProntaParaEnvio(admin, ctx.org.orgId);
          if (!sessionId || !row.contact_id) return { ok: false, error: "session_not_found" };
          const conversationId = await ensureConversation(admin, ctx.org.orgId, row.contact_id, sessionId);
          const message = await sendMessageHandler(admin, {
            organization_id: ctx.org.orgId,
            actor: { type: "user", id: ctx.user.id },
            requestId: `outreach:${row.id}`,
          }, { conversation_id: conversationId, type: "text", body: a.text } as Parameters<typeof sendMessageHandler>[2]);
          return message.status === "sent" || message.status === "queued"
            ? { ok: true, id: message.id }
            : { ok: false, error: "send_failed" };
        } catch { return { ok: false, error: "send_failed" }; }
      },
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
  return r.status === "failed" || r.status === "limite_giorno"
    ? { ok: false, error: r.status === "limite_giorno" ? "limite_giorno" : r.errore ?? "send_failed" }
    : { ok: true, status: r.status };
  } catch {
    return { ok: false, error: "outreach_lock_unavailable" };
  } finally { await libera?.().catch(() => undefined); }
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
