import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { logger } from "@/lib/logger";
import { STAGE_DA_CONTATTARE, STAGE_IN_ATTESA } from "@/lib/outreach/config";

/**
 * Dopo un primo contatto approvato: Da contattare → In attesa.
 * Se un umano ha già spostato il lead, non tocca nulla.
 * `userId` = chi ha approvato (finisce in timeline).
 */
export async function spostaInAttesa(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; contactId: string | null; userId: string },
): Promise<"movido" | "non_in_da_contattare" | "errore"> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id")
    .eq("id", input.leadId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!lead) return "errore";

  const { data: stages } = await supabase
    .from("crm_stages")
    .select("id, slug, name")
    .eq("pipeline_id", lead.pipeline_id)
    .in("slug", [STAGE_DA_CONTATTARE, STAGE_IN_ATTESA]);
  const da = stages?.find((s) => s.slug === STAGE_DA_CONTATTARE);
  const a = stages?.find((s) => s.slug === STAGE_IN_ATTESA);
  if (!da || !a || lead.stage_id !== da.id) return "non_in_da_contattare";

  const { data: aggiornate, error } = await supabase
    .from("crm_leads")
    .update({ stage_id: a.id })
    .eq("id", lead.id)
    // Trava ottimista sullo stage di ORIGINE: se un umano ha spostato il card
    // fra la lettura e la scrittura, vince la sua decisione.
    .eq("stage_id", da.id)
    .select("id");
  if (error) {
    logger.warn("[outreach] update stage fallito", { lead_id: lead.id, error: error.message });
    return "errore";
  }
  if ((aggiornate ?? []).length === 0) return "non_in_da_contattare";

  // P0: qui NON emettiamo `lead.stage_changed` sul bus degli eventi (a
  // differenza di `lib/leads/handoff-stage-move.ts`, la forma da cui questo
  // file è copiato). Quell'evento può far partire automazioni e follow-up che
  // inviano messaggi senza approvazione umana — esattamente ciò che l'agente
  // outreach non può fare. La timeline racconta il cambio; il bus no.
  const atividade = await emitLeadActivity(supabase, {
    organizationId: input.organizationId,
    leadId: lead.id,
    contactId: input.contactId,
    type: "stage_changed",
    sourceModule: "outreach",
    sourceId: lead.id,
    actor: { type: "user", id: input.userId },
    reason: stageChangeReason(da.name as string, a.name as string),
    payload: { de: da.id, para: a.id },
  });
  if (!atividade.ok) {
    // Il card è già mosso: la timeline non può bloccare l'operazione che
    // descrive. Ma "non bloccare" non è "non raccontare" — stessa forma di
    // `handoff-stage-move.ts`.
    await registraFalhaDeAtividade(supabase, {
      organizationId: input.organizationId,
      leadId: lead.id,
      tipo: "stage_changed",
      origem: "lib/outreach/move-to-waiting",
      erro: atividade.error,
    });
  }
  return "movido";
}