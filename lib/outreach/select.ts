import {
  GIORNI_DEDUP,
  MAX_PROPOSTE_PER_GIRO,
  OUTREACH_WA_FOLLOWUP_GIORNI,
  outreachWaFollowup,
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
  phone: string | null;
  isBlocked: boolean;
  stageSlug: string;
}

export interface StoricoProposta {
  leadId: string;
  kind: OutreachKind;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
  dryRun: boolean;
}

export interface NuovaProposta {
  leadId: string;
  contactId: string | null;
  kind: OutreachKind;
  channel: "email" | "wa";
  templateRef: string;
  toAddress: string;
  subject: string;
  body: string;
  reason: string;
}

const GIORNO_MS = 86_400_000;

export function cellulareItaliano(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length === 12) digits = digits.slice(2);
  return /^3\d{9}$/.test(digits) ? `+39${digits}` : null;
}

export function scegliProposte(
  candidati: Candidato[],
  storico: StoricoProposta[],
  ora: Date,
  opzioni: { waFollowup?: boolean; waGiorni?: number } = {},
): NuovaProposta[] {
  const waFollowup = opzioni.waFollowup ?? outreachWaFollowup();
  const waGiorni = opzioni.waGiorni ?? OUTREACH_WA_FOLLOWUP_GIORNI;
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
    const recente = mie.some((s) => !(c.stageSlug === STAGE_DA_CONTATTARE && s.kind === "first_contact" && s.status === "sent" && s.dryRun)
      && ora.getTime() - Date.parse(s.createdAt) < GIORNI_DEDUP * GIORNO_MS);
    if (recente) continue;

    let kind: OutreachKind | null = null;
    let reason = "";
    if (c.stageSlug === STAGE_DA_CONTATTARE && !mie.some((s) => s.kind === "first_contact" && (s.status === "pending" || (s.status === "sent" && !s.dryRun)))) {
      kind = "first_contact";
      reason = "Lead in «Da contattare» mai contattato";
    } else if (waFollowup && c.stageSlug === STAGE_IN_ATTESA && cellulareItaliano(c.phone) && !mie.some((s) => s.kind === "followup")) {
      const inviato = mie.find((s) => s.kind === "first_contact" && s.status === "sent" && !s.dryRun && s.sentAt);
      if (inviato && ora.getTime() - Date.parse(inviato.sentAt!) >= waGiorni * GIORNO_MS) {
        kind = "followup";
        reason = `Nessuna risposta ${waGiorni}+ giorni dopo il primo contatto`;
      }
    }
    if (!kind) continue;

    const segmento = segmentoDelLead(c);
    const channel = kind === "followup" ? "wa" : "email";
    const r = renderOutreach({ kind, segmento, nomeStudio: c.title ?? "" });
    out.push({
      leadId: c.leadId,
      contactId: c.contactId,
      kind,
      channel,
      templateRef: r.templateRef,
      toAddress: channel === "wa" ? cellulareItaliano(c.phone)! : c.email,
      subject: r.subject,
      body: r.body,
      reason: `${reason} · segmento ${segmento}`,
    });
  }
  return out;
}
