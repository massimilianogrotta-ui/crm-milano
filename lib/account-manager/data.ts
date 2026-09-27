/**
 * Letture e scritture dell'API Account manager. Client service-role: OGNI query
 * filtra per `ctx.organization_id` (che viene dal token, mai dal client).
 *
 * Dove stanno le cose (il CRM non ha colonne dedicate):
 *  - azienda del contatto → `contacts.custom_fields.azienda`, oppure il titolo
 *    di una sua trattativa (i lead importati hanno il nome dell'attività nel titolo);
 *  - prossimo passo della trattativa → `crm_leads.custom_fields.prossimo_passo`
 *    (+ `prossimo_passo_entro`);
 *  - data ultimo contatto → `contacts.last_activity_at` (denormalizzata da trigger);
 *  - data ultimo movimento → `crm_leads.updated_at` (+ `stage_changed_at`).
 */
import { ApiError } from "@/lib/api/types";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { moveLeadHandler } from "@/app/api/v1/leads/_handler";

import type { AmCtx } from "./guard";
import type { z } from "zod";
import type {
  addNoteBody,
  createContactBody,
  createDraftBody,
  listContactsQuery,
  listLeadsQuery,
  updateLeadBody,
} from "./schemas";

const CONTACT_COLS = "id, name, display_name, email, phone_number, tags, custom_fields, last_activity_at, created_at";
const LEAD_COLS =
  "id, title, status, value_cents, currency, contact_id, pipeline_id, stage_id, custom_fields, lost_reason, expected_close_date, last_activity_at, stage_changed_at, updated_at, created_at, crm_stages(name)";

/** Toglie i caratteri che cambiano il senso di un filtro PostgREST. */
function safeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/[,()*:"]/g, " ").trim();
}

function notFound(ctx: AmCtx, what: string): ApiError {
  return new ApiError(404, "not_found", undefined, ctx.requestId, `${what} non trovato.`);
}

function dbError(ctx: AmCtx, err: { message: string }): ApiError {
  return new ApiError(500, "internal_error", undefined, ctx.requestId, err.message);
}

type Row = Record<string, unknown>;

/** Codici di perdita canonici (fn_validate_lost_reason_required nel baseline). */
const LOST_REASONS = [
  "requested_by_customer",
  "price",
  "no_response",
  "product_unavailable",
  "cancelled_by_store",
  "cancelled_by_customer",
  "payment_failed",
  "other",
];

function shapeContact(c: Row) {
  const cf = (c.custom_fields ?? {}) as Row;
  return {
    id: c.id,
    nome: c.display_name ?? c.name,
    email: c.email,
    telefono: c.phone_number,
    azienda: typeof cf.azienda === "string" ? cf.azienda : null,
    tag: c.tags ?? [],
    ultimo_contatto: c.last_activity_at,
    creato_il: c.created_at,
  };
}

function shapeLead(l: Row) {
  const cf = (l.custom_fields ?? {}) as Row;
  const stage = l.crm_stages as { name?: string } | null;
  return {
    id: l.id,
    titolo: l.title,
    stato: l.status,
    fase_id: l.stage_id,
    fase: stage?.name ?? null,
    pipeline_id: l.pipeline_id,
    contact_id: l.contact_id,
    valore: l.value_cents == null ? null : Number(l.value_cents) / 100,
    valuta: l.currency,
    prossimo_passo: typeof cf.prossimo_passo === "string" ? cf.prossimo_passo : null,
    prossimo_passo_entro: typeof cf.prossimo_passo_entro === "string" ? cf.prossimo_passo_entro : null,
    motivo_perdita: l.lost_reason,
    chiusura_prevista: l.expected_close_date,
    ultimo_movimento: l.updated_at,
    cambio_fase_il: l.stage_changed_at,
    ultima_attivita: l.last_activity_at,
    creato_il: l.created_at,
  };
}

async function assertContact(ctx: AmCtx, contactId: string): Promise<Row> {
  const { data, error } = await ctx.supabase
    .from("contacts")
    .select(CONTACT_COLS)
    .eq("organization_id", ctx.organization_id)
    .eq("id", contactId)
    .is("is_merged_into", null)
    .maybeSingle();
  if (error) throw dbError(ctx, error);
  if (!data) throw notFound(ctx, "Contatto");
  return data as Row;
}

async function assertLead(ctx: AmCtx, leadId: string): Promise<Row> {
  const { data, error } = await ctx.supabase
    .from("crm_leads")
    .select(LEAD_COLS)
    .eq("organization_id", ctx.organization_id)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw dbError(ctx, error);
  if (!data) throw notFound(ctx, "Trattativa");
  return data as Row;
}

// ─── LETTURE ────────────────────────────────────────────────────────────────

export async function listContacts(ctx: AmCtx, q: z.infer<typeof listContactsQuery>) {
  let query = ctx.supabase
    .from("contacts")
    .select(CONTACT_COLS, { count: "exact" })
    .eq("organization_id", ctx.organization_id)
    .is("is_merged_into", null)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("id")
    .range(q.offset, q.offset + q.limit - 1);

  if (q.nome) {
    const s = safeLike(q.nome);
    query = query.or(`name.ilike.%${s}%,display_name.ilike.%${s}%`);
  }
  if (q.tag) query = query.contains("tags", [q.tag]);
  if (q.ultimo_contatto_dal) query = query.gte("last_activity_at", q.ultimo_contatto_dal);
  if (q.ultimo_contatto_al) query = query.lte("last_activity_at", q.ultimo_contatto_al);
  if (q.azienda) {
    const s = safeLike(q.azienda);
    const { data: leads, error } = await ctx.supabase
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", ctx.organization_id)
      .ilike("title", `%${s}%`)
      .not("contact_id", "is", null)
      .limit(500);
    if (error) throw dbError(ctx, error);
    const ids = [...new Set((leads ?? []).map((l) => l.contact_id as string))];
    const parts = [`custom_fields->>azienda.ilike.%${s}%`];
    if (ids.length) parts.push(`id.in.(${ids.join(",")})`);
    query = query.or(parts.join(","));
  }

  const { data, error, count } = await query;
  if (error) throw dbError(ctx, error);
  return { items: (data ?? []).map((c) => shapeContact(c as Row)), totale: count ?? null };
}

export async function getContactDetail(ctx: AmCtx, contactId: string) {
  const contact = await assertContact(ctx, contactId);

  const [leadsRes, notesRes, draftsRes] = await Promise.all([
    ctx.supabase
      .from("crm_leads")
      .select(LEAD_COLS)
      .eq("organization_id", ctx.organization_id)
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(50),
    ctx.supabase
      .from("lead_notes")
      .select("id, headline, body, created_at")
      .eq("organization_id", ctx.organization_id)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("account_manager_followup_drafts")
      .select("id, lead_id, channel, subject, body, status, created_at")
      .eq("organization_id", ctx.organization_id)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  for (const r of [leadsRes, notesRes, draftsRes]) if (r.error) throw dbError(ctx, r.error);

  const leads = (leadsRes.data ?? []) as Row[];
  let attivita: Row[] = [];
  if (leads.length) {
    const { data, error } = await ctx.supabase
      .from("crm_lead_activities")
      .select("id, lead_id, type, reason, payload, actor_kind, performed_at")
      .eq("organization_id", ctx.organization_id)
      .in("lead_id", leads.map((l) => l.id as string))
      .order("performed_at", { ascending: false })
      .limit(100);
    if (error) throw dbError(ctx, error);
    attivita = (data ?? []) as Row[];
  }

  return {
    contatto: shapeContact(contact),
    trattative: leads.map(shapeLead),
    storico_attivita: attivita.map((a) => ({
      id: a.id,
      lead_id: a.lead_id,
      tipo: a.type,
      descrizione: a.reason,
      dettagli: a.payload,
      autore: a.actor_kind,
      il: a.performed_at,
    })),
    note: (notesRes.data ?? []).map((n) => ({ id: n.id, titolo: n.headline, testo: n.body, creata_il: n.created_at })),
    bozze_followup: (draftsRes.data ?? []).map((d) => ({
      id: d.id,
      lead_id: d.lead_id,
      canale: d.channel,
      oggetto: d.subject,
      testo: d.body,
      stato: d.status,
      creata_il: d.created_at,
    })),
  };
}

export async function listLeads(ctx: AmCtx, q: z.infer<typeof listLeadsQuery>) {
  let query = ctx.supabase
    .from("crm_leads")
    .select(LEAD_COLS, { count: "exact" })
    .eq("organization_id", ctx.organization_id)
    .order("updated_at", { ascending: false })
    .order("id")
    .range(q.offset, q.offset + q.limit - 1);
  if (q.stato) query = query.eq("status", q.stato);
  if (q.contact_id) query = query.eq("contact_id", q.contact_id);
  if (q.pipeline_id) query = query.eq("pipeline_id", q.pipeline_id);
  if (q.stage_id) query = query.eq("stage_id", q.stage_id);
  if (q.mossi_dal) query = query.gte("updated_at", q.mossi_dal);

  const { data, error, count } = await query;
  if (error) throw dbError(ctx, error);
  return { items: (data ?? []).map((l) => shapeLead(l as Row)), totale: count ?? null };
}

/** Fasi disponibili, per sapere quali `stage_id` si possono usare. */
export async function listStages(ctx: AmCtx) {
  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .select("id, name, pipeline_id, position, is_won, is_lost")
    .eq("organization_id", ctx.organization_id)
    .eq("is_archived", false)
    .order("pipeline_id")
    .order("position");
  if (error) throw dbError(ctx, error);
  return (data ?? []).map((s) => ({
    id: s.id,
    nome: s.name,
    pipeline_id: s.pipeline_id,
    ordine: s.position,
    vinta: s.is_won,
    persa: s.is_lost,
  }));
}

// ─── SCRITTURE ──────────────────────────────────────────────────────────────

export async function createContact(ctx: AmCtx, b: z.infer<typeof createContactBody>) {
  // Insert diretto e minimale, di proposito: `createContactHandler` apre anche
  // una conversazione sul canale WhatsApp quando c'è il telefono. Qui si crea
  // SOLO l'anagrafica — nessun canale, nessun messaggio.
  const { data, error } = await ctx.supabase
    .from("contacts")
    .insert({
      organization_id: ctx.organization_id,
      name: b.nome,
      email: b.email ?? null,
      phone_number: b.telefono ?? null,
      tags: b.tag ?? [],
      source: "account_manager_api",
      source_metadata: { api_token_id: ctx.tokenId },
      custom_fields: b.azienda ? { azienda: b.azienda } : {},
    })
    .select(CONTACT_COLS)
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ApiError(409, "conflict", undefined, ctx.requestId, "Esiste già un contatto con questo telefono o email.");
    }
    throw dbError(ctx, error);
  }
  return shapeContact(data as Row);
}

export async function addNote(ctx: AmCtx, contactId: string, b: z.infer<typeof addNoteBody>) {
  await assertContact(ctx, contactId);

  if (b.tipo === "nota") {
    const { data, error } = await ctx.supabase
      .from("lead_notes")
      .insert({
        organization_id: ctx.organization_id,
        contact_id: contactId,
        headline: b.titolo ?? "Nota Account manager",
        body: b.testo,
      })
      .select("id, headline, body, created_at")
      .single();
    if (error) throw dbError(ctx, error);
    return { tipo: "nota", id: data.id, titolo: data.headline, testo: data.body, creata_il: data.created_at };
  }

  const lead = await assertLead(ctx, b.lead_id!);
  if (lead.contact_id !== contactId) {
    throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "La trattativa non è di questo contatto.");
  }
  const res = await emitLeadActivity(ctx.supabase, {
    organizationId: ctx.organization_id,
    leadId: b.lead_id!,
    contactId,
    type: "note",
    sourceModule: "crm",
    actor: ctx.actor,
    reason: b.titolo ?? "Attività registrata dall'Account manager",
    payload: { testo: b.testo, via: "account_manager_api" },
  });
  if (!res.ok) throw dbError(ctx, { message: res.error ?? "activity insert failed" });
  return { tipo: "attivita", lead_id: b.lead_id, titolo: b.titolo ?? null, testo: b.testo };
}

export async function updateLead(ctx: AmCtx, leadId: string, b: z.infer<typeof updateLeadBody>) {
  const lead = await assertLead(ctx, leadId);
  const handlerCtx = { organization_id: ctx.organization_id, actor: ctx.actor, requestId: ctx.requestId, idioma: "it" as const };

  if (b.stage_id) {
    const { data: stage, error } = await ctx.supabase
      .from("crm_stages")
      .select("id, pipeline_id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", b.stage_id)
      .maybeSingle();
    if (error) throw dbError(ctx, error);
    if (!stage) throw notFound(ctx, "Fase");
    if (stage.pipeline_id !== lead.pipeline_id) {
      throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "La fase è di un'altra pipeline.");
    }
    await moveLeadHandler(ctx.supabase, handlerCtx, leadId, {
      to_stage_id: b.stage_id,
      reason: "Spostata dall'agente Account manager",
    });
  }

  if (b.esito) {
    let motivo = b.motivo ?? null;
    let motivoLibero: string | null = null;
    if (b.esito === "lost" && motivo) {
      const { data: pipe, error } = await ctx.supabase
        .from("crm_pipelines")
        .select("settings")
        .eq("organization_id", ctx.organization_id)
        .eq("id", lead.pipeline_id as string)
        .maybeSingle();
      if (error) throw dbError(ctx, error);
      const extra = ((pipe?.settings as Row | null)?.lost_reasons ?? []) as unknown[];
      if (![...LOST_REASONS, ...extra.map(String)].includes(motivo)) {
        motivoLibero = motivo;
        motivo = "other";
      }
    }
    await encerraDemanda(ctx.supabase, handlerCtx, { leadId, desfecho: b.esito, motivo });
    if (motivoLibero) {
      await emitLeadActivity(ctx.supabase, {
        organizationId: ctx.organization_id,
        leadId,
        contactId: (lead.contact_id as string | null) ?? null,
        type: "note",
        sourceModule: "crm",
        actor: ctx.actor,
        reason: "Motivo della perdita (Account manager)",
        payload: { motivo: motivoLibero },
      });
    }
  }

  if (b.prossimo_passo !== undefined || b.prossimo_passo_entro !== undefined) {
    const { data: fresh, error: readErr } = await ctx.supabase
      .from("crm_leads")
      .select("custom_fields")
      .eq("organization_id", ctx.organization_id)
      .eq("id", leadId)
      .single();
    if (readErr) throw dbError(ctx, readErr);
    const cf = { ...((fresh.custom_fields ?? {}) as Row) };
    if (b.prossimo_passo !== undefined) cf.prossimo_passo = b.prossimo_passo;
    if (b.prossimo_passo_entro !== undefined) cf.prossimo_passo_entro = b.prossimo_passo_entro;
    const { error } = await ctx.supabase
      .from("crm_leads")
      .update({ custom_fields: cf })
      .eq("organization_id", ctx.organization_id)
      .eq("id", leadId);
    if (error) throw dbError(ctx, error);
    await emitLeadActivity(ctx.supabase, {
      organizationId: ctx.organization_id,
      leadId,
      contactId: (lead.contact_id as string | null) ?? null,
      type: "note",
      sourceModule: "crm",
      actor: ctx.actor,
      reason: "Prossimo passo aggiornato dall'Account manager",
      payload: { prossimo_passo: cf.prossimo_passo ?? null, prossimo_passo_entro: cf.prossimo_passo_entro ?? null },
    });
  }

  return shapeLead(await assertLead(ctx, leadId));
}

export async function createDraft(ctx: AmCtx, contactId: string, b: z.infer<typeof createDraftBody>) {
  await assertContact(ctx, contactId);
  if (b.lead_id) {
    const lead = await assertLead(ctx, b.lead_id);
    if (lead.contact_id !== contactId) {
      throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "La trattativa non è di questo contatto.");
    }
  }
  const { data, error } = await ctx.supabase
    .from("account_manager_followup_drafts")
    .insert({
      organization_id: ctx.organization_id,
      contact_id: contactId,
      lead_id: b.lead_id ?? null,
      channel: b.canale,
      subject: b.oggetto ?? null,
      body: b.testo,
      created_by_api_token_id: ctx.tokenId,
    })
    .select("id, lead_id, channel, subject, body, status, created_at")
    .single();
  if (error) throw dbError(ctx, error);
  return {
    id: data.id,
    lead_id: data.lead_id,
    canale: data.channel,
    oggetto: data.subject,
    testo: data.body,
    stato: data.status,
    creata_il: data.created_at,
    nota: "Solo bozza: nessun messaggio è stato inviato.",
  };
}
