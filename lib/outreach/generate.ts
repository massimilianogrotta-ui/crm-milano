import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { isOutreachDryRun, OUTREACH_PIPELINE_SLUG, STAGE_DA_CONTATTARE, STAGE_IN_ATTESA } from "@/lib/outreach/config";
import { scegliProposte, type Candidato, type StoricoProposta } from "@/lib/outreach/select";

export interface EsitoGenerazione {
  stato: "ok" | "pipeline_assente" | "errore";
  candidati: number;
  create: number;
  errore?: string;
}

const BLOCCO_STORICO = 100;

/** Usa l'admin client: OGNI query filtra organization_id a mano (regola di lib/supabase/admin.ts). */
export async function generaProposte(admin: SupabaseClient, orgId: string, ora = new Date()): Promise<EsitoGenerazione> {
  function errore(fase: string, message: string, candidati = 0, create = 0): EsitoGenerazione {
    logger.warn("[outreach] giro in errore", { organization_id: orgId, fase, error: message });
    return { stato: "errore", candidati, create, errore: message };
  }

  const { data: pipeline, error: ePipe } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", OUTREACH_PIPELINE_SLUG)
    .maybeSingle();
  if (ePipe) return errore("pipeline", ePipe.message);
  if (!pipeline) return { stato: "pipeline_assente", candidati: 0, create: 0 };

  const { data: stages, error: eStages } = await admin
    .from("crm_stages")
    .select("id, slug")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .in("slug", [STAGE_DA_CONTATTARE, STAGE_IN_ATTESA]);
  if (eStages) return errore("stages", eStages.message);
  const slugPerId = new Map((stages ?? []).map((s) => [s.id as string, s.slug as string]));
  if (slugPerId.size === 0) return { stato: "pipeline_assente", candidati: 0, create: 0 };

  const { data: leads, error: eLeads } = await admin
    .from("crm_leads")
    .select("id, title, tags, stage_id, contact_id, contacts(email, is_blocked)")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .eq("status", "open")
    .in("stage_id", [...slugPerId.keys()])
    .order("created_at", { ascending: true })
    .limit(500);
  if (eLeads) return errore("leads", eLeads.message);

  const candidati: Candidato[] = (leads ?? []).map((l) => {
    const contatto = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as
      | { email: string | null; is_blocked: boolean }
      | null;
    return {
      leadId: l.id as string,
      contactId: (l.contact_id as string | null) ?? null,
      title: (l.title as string | null) ?? null,
      tags: (l.tags as string[] | null) ?? [],
      email: contatto?.email ?? null,
      // Senza contatto non sappiamo se è bloccato: trattalo come bloccato.
      isBlocked: contatto ? contatto.is_blocked : true,
      stageSlug: slugPerId.get(l.stage_id as string) ?? "",
    };
  });

  const storico: StoricoProposta[] = [];
  // Limita gli ID per richiesta: la query GET con tutti i lead supera il limite degli header.
  for (let i = 0; i < candidati.length; i += BLOCCO_STORICO) {
    const { data: storicoRows, error: eStorico } = await admin
      .from("outreach_proposals")
      .select("lead_id, kind, status, created_at, sent_at")
      .eq("organization_id", orgId)
      .eq("channel", "email")
      .in("lead_id", candidati.slice(i, i + BLOCCO_STORICO).map((c) => c.leadId));
    if (eStorico) return errore("storico", eStorico.message, candidati.length);
    storico.push(...(storicoRows ?? []).map((s) => ({
      leadId: s.lead_id as string,
      kind: s.kind as StoricoProposta["kind"],
      status: s.status as StoricoProposta["status"],
      createdAt: s.created_at as string,
      sentAt: (s.sent_at as string | null) ?? null,
    })));
  }

  const nuove = scegliProposte(candidati, storico, ora);
  if (nuove.length === 0) return { stato: "ok", candidati: candidati.length, create: 0 };

  // Non è l'`upsert(..., { onConflict: "lead_id,channel" })` del piano: su
  // questa tabella l'unico indice unico su (lead_id, channel) è PARZIALE
  // (`where status = 'pending'`, migration 0238), e Postgres rifiuta di
  // inferire un indice parziale in `ON CONFLICT` senza il predicato — l'errore
  // che la nota del piano anticipa. Perciò insert riga per riga, ignorando il
  // codice 23505 (proposta pending già esistente per quel lead+canale): conta
  // solo chi entra davvero.
  const dryRun = isOutreachDryRun();
  const create: string[] = [];
  for (const n of nuove) {
    const { data: riga, error: eIns } = await admin
      .from("outreach_proposals")
      .insert({
        organization_id: orgId,
        lead_id: n.leadId,
        contact_id: n.contactId,
        channel: "email",
        kind: n.kind,
        template_ref: n.templateRef,
        to_address: n.toAddress,
        subject: n.subject,
        body: n.body,
        reason: n.reason,
        status: "pending",
        dry_run: dryRun,
      })
      .select("id")
      .single();
    if (eIns) {
      if (eIns.code === "23505") continue;
      return errore("insert", eIns.message, candidati.length, create.length);
    }
    if (riga?.id) create.push(riga.id as string);
  }
  return { stato: "ok", candidati: candidati.length, create: create.length };
}
