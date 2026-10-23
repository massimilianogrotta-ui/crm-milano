/**
 * Regole di esclusione della fase 0. Funzione pura: niente I/O, niente invio.
 *
 * L'ordine è quello del piano: la prima che scatta vince, così il conteggio
 * per categoria non conta due volte lo stesso candidato. `contatto_condiviso`,
 * `dominio_gia_nel_giro` e `gia_contattato` non escono di qui — li assegna
 * `scegliProposte`, perché dipendono dal giro e dallo storico.
 */

export const MOTIVI = [
  "pec",
  "stop",
  "freemail",
  "nominativa",
  "dominio_incoerente",
  "titolo_articolo",
  "contatto_condiviso",
  "dominio_gia_nel_giro",
  "gia_contattato",
] as const;

export type Motivo = (typeof MOTIVI)[number];
export type ContatoriEsclusione = Record<Motivo, number>;

export function contatoriVuoti(): ContatoriEsclusione {
  return Object.fromEntries(MOTIVI.map((m) => [m, 0])) as ContatoriEsclusione;
}

/** Sottoinsieme di `Candidato` che questa funzione sa leggere. */
export interface IngressoEsclusione {
  email: string | null;
  title: string | null;
  tags: string[] | null;
  contactTags: string[] | null;
}

const DOMINI_PEC = ["pec.it", "legalmail.it", "impresa.italia.it"] as const;

const FREEMAIL_ESATTI = new Set([
  "gmail.com",
  "libero.it",
  "icloud.com",
  "alice.it",
  "tiscali.it",
  "virgilio.it",
]);

/** `hotmail.*`, `yahoo.*`, `outlook.*`, `live.*`: la label, non un prefisso del nome. */
const FREEMAIL_LABEL = new Set(["hotmail", "yahoo", "outlook", "live"]);

/**
 * Caselle di ruolo. Un locale `nome.cognome` che usa una di queste non è una
 * persona: `studio.rossi` resta una casella dello studio.
 */
const LOCALI_GENERICI = new Set([
  "info",
  "segreteria",
  "studio",
  "reception",
  "contatti",
  "amministrazione",
  "prenotazioni",
  "clinica",
  "direzione",
]);

/** Parole che non identificano l'attività: non servono a giudicare il dominio. */
const STOPWORD_TITOLO = new Set([
  "studio",
  "dentistico",
  "centro",
  "estetico",
  "milano",
  "dott",
  "clinica",
]);

export function dominioFreemail(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (FREEMAIL_ESATTI.has(d)) return true;
  const labels = d.split(".");
  return labels.some((label, i) => i < labels.length - 1 && FREEMAIL_LABEL.has(label));
}

function senzaAccenti(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function haTag(tags: string[] | null | undefined, nome: string): boolean {
  return (tags ?? []).some((t) => t.trim().toLowerCase() === nome);
}

function partiEmail(email: string): { local: string; domain: string } | null {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at <= 0 || at === clean.length - 1) return null;
  return { local: clean.slice(0, at), domain: clean.slice(at + 1) };
}

function dominioPec(domain: string): boolean {
  if (DOMINI_PEC.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return domain.split(".").some((label) => label.includes("pec"));
}

function nominativa(local: string): boolean {
  const m = /^([\p{L}]{2,})[._-]([\p{L}]{2,})$/u.exec(local);
  if (!m) return false;
  const [a, b] = [m[1].toLowerCase(), m[2].toLowerCase()];
  return !LOCALI_GENERICI.has(a) && !LOCALI_GENERICI.has(b);
}

function tokenDistintivi(title: string): string[] {
  const norm = senzaAccenti(title.toLowerCase());
  return norm.split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOPWORD_TITOLO.has(t));
}

function titoloArticolo(title: string): boolean {
  const t = title.trim();
  if (t.includes("?")) return true;
  const n = senzaAccenti(t.toLowerCase());
  if (/^(come|quanto|ogni|dove|perche|cosa|i migliori)\b/.test(n)) return true;
  if (/^\d+\s+segreti\b/.test(n)) return true;
  return t.length > 70 && t.includes(":");
}

export function motivoEsclusione(c: IngressoEsclusione): Motivo | null {
  const email = c.email ? partiEmail(c.email) : null;
  if (email && dominioPec(email.domain)) return "pec";
  if (haTag(c.tags, "stop") || haTag(c.contactTags, "stop")) return "stop";
  if (email && dominioFreemail(email.domain)) return "freemail";
  if (email && nominativa(email.local)) return "nominativa";
  // Senza un token distintivo non si può dire che il dominio è incoerente:
  // «Studio Dentistico» da solo non nomina nessuno. Il tag sul contatto, non
  // sul lead, è la verifica fatta sul sito.
  if (email && !haTag(c.contactTags, "email-verificata")) {
    const token = tokenDistintivi(c.title ?? "");
    if (token.length > 0 && !token.some((t) => senzaAccenti(email.domain).includes(t))) {
      return "dominio_incoerente";
    }
  }
  if (c.title && titoloArticolo(c.title)) return "titolo_articolo";
  return null;
}
