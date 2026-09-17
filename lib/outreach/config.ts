import { env } from "@/lib/env";

/**
 * Interruttore di sicurezza: qualsiasi valore diverso da "false" esatto
 * significa "non inviare davvero". Sbagliare a scrivere non deve mai
 * trasformarsi in email vere.
 */
export function outreachDryRun(raw: string | undefined): boolean {
  return raw !== "false";
}

export function isOutreachDryRun(): boolean {
  return outreachDryRun(env.OUTREACH_DRY_RUN);
}

export function outreachOrgId(): string | null {
  const id = env.OUTREACH_ORG_ID.trim();
  return id.length > 0 ? id : null;
}

export const OUTREACH_PIPELINE_SLUG = "milano-prospect";
export const STAGE_DA_CONTATTARE = "da-contattare";
export const STAGE_IN_ATTESA = "in-attesa";
export const MAX_PROPOSTE_PER_GIRO = 20;
export const GIORNI_DEDUP = 7;
export const GIORNI_PRIMA_DEL_RICONTATTO = 7;