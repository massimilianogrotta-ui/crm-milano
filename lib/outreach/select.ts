import {
  GIORNI_DEDUP,
  GIORNI_PRIMA_DEL_RICONTATTO,
  MAX_PROPOSTE_PER_GIRO,
  STAGE_DA_CONTATTARE,
  STAGE_IN_ATTESA,
} from "@/lib/outreach/config";
import { renderOutreach, segmentoDelLead, type OutreachKind } from "@/lib/outreach/templates";

export interface Candidato {
  leadId: string;
  contactId: string | null;
  title: string | null;
  tags: string[] | null;
  email: string | null;
  isBlocked: boolean;
  stageSlug: string;
}

export interface StoricoProposta {
  leadId: string;
  kind: OutreachKind;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
}

export interface NuovaProposta {
  leadId: string;
  contactId: string | null;
  kind: OutreachKind;
  templateRef: string;
  toAddress: string;
  subject: string;
  body: string;
  reason: string;
}

const GIORNO_MS = 86_400_000;

export function scegliProposte(
  candidati: Candidato[],
  storico: StoricoProposta[],
  ora: Date,
): NuovaProposta[] {
  const perLead = new Map<string, StoricoProposta[]>();
  for (const s of storico) {
    const lista = perLead.get(s.leadId) ?? [];
    lista.push(s);
    perLead.set(s.leadId, lista);
  }

  const out: NuovaProposta[] = [];
  for (const c of candidati) {
    if (out.length >= MAX_PROPOSTE_PER_GIRO) break;
    if (c.isBlocked || !c.email) continue;

    const mie = perLead.get(c.leadId) ?? [];
    const recente = mie.some((s) => ora.getTime() - Date.parse(s.createdAt) < GIORNI_DEDUP * GIORNO_MS);
    if (recente) continue;

    let kind: OutreachKind | null = null;
    let reason = "";
    if (c.stageSlug === STAGE_DA_CONTATTARE && !mie.some((s) => s.kind === "first_contact")) {
      kind = "first_contact";
      reason = "Lead in «Da contattare» mai contattato";
    } else if (c.stageSlug === STAGE_IN_ATTESA && !mie.some((s) => s.kind === "followup")) {
      const inviato = mie.find((s) => s.kind === "first_contact" && s.status === "sent" && s.sentAt);
      if (inviato && ora.getTime() - Date.parse(inviato.sentAt!) >= GIORNI_PRIMA_DEL_RICONTATTO * GIORNO_MS) {
        kind = "followup";
        reason = `Nessuna risposta ${GIORNI_PRIMA_DEL_RICONTATTO}+ giorni dopo il primo contatto`;
      }
    }
    if (!kind) continue;

    const segmento = segmentoDelLead(c);
    const r = renderOutreach({ kind, segmento, nomeStudio: c.title ?? "" });
    out.push({
      leadId: c.leadId,
      contactId: c.contactId,
      kind,
      templateRef: r.templateRef,
      toAddress: c.email,
      subject: r.subject,
      body: r.body,
      reason: `${reason} · segmento ${segmento}`,
    });
  }
  return out;
}