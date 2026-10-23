import {
  GIORNI_DEDUP,
  MAX_PROPOSTE_PER_GIRO,
  OUTREACH_WA_FOLLOWUP_GIORNI,
  outreachWaFollowup,
  STAGE_DA_CONTATTARE,
  STAGE_IN_ATTESA,
} from "@/lib/outreach/config";
import {
  contatoriVuoti,
  dominioFreemail,
  motivoEsclusione,
  type ContatoriEsclusione,
  type Motivo,
} from "@/lib/outreach/esclusioni";
import { renderOutreach, segmentoDelLead, type OutreachKind } from "@/lib/outreach/templates";

export interface Candidato {
  leadId: string;
  contactId: string | null;
  title: string | null;
  tags: string[] | null;
  contactTags: string[] | null;
  email: string | null;
  phone: string | null;
  isBlocked: boolean;
  stageSlug: string;
}

export interface StoricoProposta {
  leadId: string;
  contactId?: string | null;
  toAddress?: string | null;
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

export interface ProposteScelte extends Array<NuovaProposta> {
  esclusi: ContatoriEsclusione;
}

const GIORNO_MS = 86_400_000;

export function cellulareItaliano(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length === 12) digits = digits.slice(2);
  return /^3\d{9}$/.test(digits) ? `+39${digits}` : null;
}

/**
 * Trim e minuscolo, nient'altro. Il «+tag» (`info+news@studio.it`) resta:
 * non è un alias della casella senza tag, e due tag diversi non si fondono.
 */
function chiaveEmail(email: string): string {
  return email.trim().toLowerCase();
}

function dominioEmail(email: string): string {
  const clean = chiaveEmail(email);
  const at = clean.lastIndexOf("@");
  return at >= 0 ? clean.slice(at + 1) : "";
}

function diProva(s: StoricoProposta): boolean {
  return s.status === "sent" && s.dryRun;
}

function stessoSoggetto(s: StoricoProposta, c: Candidato): boolean {
  if (c.contactId && s.contactId && s.contactId === c.contactId) return true;
  if (s.toAddress && c.email && chiaveEmail(s.toAddress) === chiaveEmail(c.email)) return true;
  return false;
}

export function scegliProposte(
  candidati: Candidato[],
  storico: StoricoProposta[],
  ora: Date,
  opzioni: { waFollowup?: boolean; waGiorni?: number } = {},
): ProposteScelte {
  const waFollowup = opzioni.waFollowup ?? outreachWaFollowup();
  const waGiorni = opzioni.waGiorni ?? OUTREACH_WA_FOLLOWUP_GIORNI;
  const perLead = new Map<string, StoricoProposta[]>();
  for (const s of storico) {
    const lista = perLead.get(s.leadId) ?? [];
    lista.push(s);
    perLead.set(s.leadId, lista);
  }

  const esclusi = contatoriVuoti();
  const out = Object.assign([] as NuovaProposta[], { esclusi }) as ProposteScelte;
  const usatiContatto = new Set<string>();
  const usatiEmail = new Set<string>();
  const usatiDominio = new Set<string>();
  const conta = (motivo: Motivo) => {
    esclusi[motivo] += 1;
  };

  for (const c of candidati) {
    if (c.isBlocked || !c.email) continue;
    const motivo = motivoEsclusione(c);
    if (motivo) {
      conta(motivo);
      continue;
    }

    const mie = perLead.get(c.leadId) ?? [];
    const recente = mie.some((s) => !(c.stageSlug === STAGE_DA_CONTATTARE && s.kind === "first_contact" && s.status === "sent" && s.dryRun)
      && ora.getTime() - Date.parse(s.createdAt) < GIORNI_DEDUP * GIORNO_MS);
    if (recente) continue;

    let kind: OutreachKind | null = null;
    let reason = "";
    // Solo l'invio di prova e l'invio fallito liberano il lead: un «Rifiuta» di Max
    // o un'approvazione rimasta a metà non devono far tornare la stessa proposta.
    if (c.stageSlug === STAGE_DA_CONTATTARE && !mie.some((s) => s.kind === "first_contact" && !diProva(s) && s.status !== "failed")) {
      kind = "first_contact";
      reason = "Lead in «Da contattare» mai contattato";
    } else if (waFollowup && c.stageSlug === STAGE_IN_ATTESA && cellulareItaliano(c.phone) && !mie.some((s) => s.kind === "followup" && !diProva(s))) {
      const inviato = mie.find((s) => s.kind === "first_contact" && s.status === "sent" && !s.dryRun && s.sentAt);
      if (inviato && ora.getTime() - Date.parse(inviato.sentAt!) >= waGiorni * GIORNO_MS) {
        kind = "followup";
        reason = `Nessuna risposta ${waGiorni}+ giorni dopo il primo contatto`;
      }
    }
    if (!kind) continue;

    // Un solo primo contatto per indirizzo e per contatto, anche su un altro lead.
    // Il follow-up WhatsApp dello stesso lead non entra qui: lo regola il ramo sopra.
    if (kind === "first_contact" && storico.some((s) =>
      s.leadId !== c.leadId && s.kind === "first_contact" && !diProva(s) && s.status !== "failed" && stessoSoggetto(s, c)
    )) {
      conta("gia_contattato");
      continue;
    }

    const emailKey = chiaveEmail(c.email);
    const dom = dominioEmail(c.email);
    if ((c.contactId && usatiContatto.has(c.contactId)) || usatiEmail.has(emailKey)) {
      conta("contatto_condiviso");
      continue;
    }
    // Una email per dominio nel giro, solo fuori dai freemail: le catene
    // (DentalPro, Epilate, Seta). Il freemail è già escluso a monte; il controllo
    // resta per non trattare gmail come se fosse una catena.
    if (kind === "first_contact" && dom && !dominioFreemail(dom) && usatiDominio.has(dom)) {
      conta("dominio_gia_nel_giro");
      continue;
    }
    if (out.length >= MAX_PROPOSTE_PER_GIRO) continue;

    const segmento = segmentoDelLead(c);
    const channel = kind === "followup" ? "wa" : "email";
    const r = renderOutreach({ kind, segmento, nomeStudio: c.title ?? "" });
    out.push({
      leadId: c.leadId,
      contactId: c.contactId,
      kind,
      channel,
      templateRef: r.templateRef,
      toAddress: channel === "wa" ? cellulareItaliano(c.phone)! : chiaveEmail(c.email),
      subject: r.subject,
      body: r.body,
      reason: `${reason} · segmento ${segmento}`,
    });
    if (c.contactId) usatiContatto.add(c.contactId);
    usatiEmail.add(emailKey);
    if (kind === "first_contact" && dom && !dominioFreemail(dom)) usatiDominio.add(dom);
  }
  return out;
}
