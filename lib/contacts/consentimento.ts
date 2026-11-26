/**
 * Consentimento de marketing com carimbo — escrita em `contacts.consent`.
 *
 * A coluna já existe e o DEFAULT já nasce com `granted_at` nulo. Ausência não
 * é recusa: a guarda compartilhada (`checarGuardasDeContato`) continua lendo
 * só `declined_at`. Quem liga a exigência é a organização, em
 * `settings.require_marketing_consent`. O padrão é não exigir, senão toda
 * instalação que nunca perguntou para de enviar.
 *
 * Só a categoria MARKETING é barrada. UTILITY segue. Categoria desconhecida
 * ou espelho ilegível também segue: falhar fechado num template que não
 * conseguimos classificar pararia o atendimento de quem não pediu o gate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export const MENSAGEM_SEM_CONSENTIMENTO = "Este contato não autorizou mensagens de marketing.";

export function exigeConsentimentoDeMarketing(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  return (settings as { require_marketing_consent?: unknown }).require_marketing_consent === true;
}

export function decidirEnvioDeMarketing(input: {
  requireMarketingConsent: boolean;
  category: string | null | undefined;
  grantedAt: string | null | undefined;
}): { permitido: true } | { permitido: false; code: "marketing_consent_required" } {
  if (!input.requireMarketingConsent) return { permitido: true };
  if ((input.category ?? "").toUpperCase() !== "MARKETING") return { permitido: true };
  if (typeof input.grantedAt === "string" && input.grantedAt.trim()) return { permitido: true };
  return { permitido: false, code: "marketing_consent_required" };
}

export function mesclarConsentimentoDeMarketing(
  atual: unknown,
  grant: { grantedAt: string; source: string; version: string | null },
): Record<string, unknown> {
  const base =
    atual && typeof atual === "object" && !Array.isArray(atual)
      ? { ...(atual as Record<string, unknown>) }
      : {};
  const marketing =
    base.marketing && typeof base.marketing === "object" && !Array.isArray(base.marketing)
      ? { ...(base.marketing as Record<string, unknown>) }
      : {};
  base.marketing = {
    ...marketing,
    granted_at: grant.grantedAt,
    source: grant.source,
    version: grant.version,
    declined_at: null,
  };
  return base;
}

export async function registrarConsentimento(
  db: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    canal?: string;
    fuente: string;
    version?: string | null;
    grantedAt?: string;
  },
): Promise<void> {
  const { data, error } = await db
    .from("contacts")
    .select("consent")
    .eq("organization_id", input.organizationId)
    .eq("id", input.contactId)
    .maybeSingle();
  if (error || !data) throw new Error("contact_not_found");

  const consent = mesclarConsentimentoDeMarketing(data.consent, {
    grantedAt: input.grantedAt ?? new Date().toISOString(),
    source: input.fuente,
    version: input.version ?? null,
  });
  // `canal` fica no carimbo de origem quando a chamada o nomeia, sem coluna nova.
  if (input.canal) {
    const marketing = consent.marketing as Record<string, unknown>;
    marketing.channel = input.canal;
  }

  const { error: gravacao } = await db
    .from("contacts")
    .update({ consent })
    .eq("organization_id", input.organizationId)
    .eq("id", input.contactId);
  if (gravacao) throw new Error(gravacao.message);
}

export async function barrarTemplateDeMarketingSemConsentimento(
  db: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    channelSessionId: string | null;
    name: string;
    language: string;
    requestId?: string;
    idioma?: Idioma;
  },
): Promise<void> {
  let settings: unknown = {};
  try {
    const { data, error } = await db
      .from("organizations")
      .select("settings")
      .eq("id", input.organizationId)
      .maybeSingle();
    if (error) return;
    settings = data?.settings ?? {};
  } catch {
    return;
  }
  if (!exigeConsentimentoDeMarketing(settings)) return;

  let category: string | null = null;
  try {
    let consulta = db
      .from("meta_templates")
      .select("category")
      .eq("organization_id", input.organizationId)
      .eq("name", input.name)
      .eq("language", input.language);
    if (input.channelSessionId) consulta = consulta.eq("channel_session_id", input.channelSessionId);
    const { data, error } = await consulta.maybeSingle();
    if (error) return;
    category = (data?.category as string | null | undefined) ?? null;
  } catch {
    return;
  }

  let grantedAt: string | null = null;
  try {
    const { data, error } = await db
      .from("contacts")
      .select("consent")
      .eq("organization_id", input.organizationId)
      .eq("id", input.contactId)
      .maybeSingle();
    if (error) return;
    const marketing = (data?.consent as { marketing?: { granted_at?: string | null } } | null)?.marketing;
    grantedAt = typeof marketing?.granted_at === "string" ? marketing.granted_at : null;
  } catch {
    return;
  }

  const decisao = decidirEnvioDeMarketing({
    requireMarketingConsent: true,
    category,
    grantedAt,
  });
  if (!decisao.permitido) {
    throw new ApiError(
      403,
      decisao.code,
      undefined,
      input.requestId ?? "",
      traduzir(MENSAGEM_SEM_CONSENTIMENTO, input.idioma ?? "pt-BR"),
    );
  }
}

export const consentimentoBodySchema = z
  .object({
    canal: z.string().trim().min(1).max(40).optional(),
    fuente: z.string().trim().min(1).max(80).optional(),
    source: z.string().trim().min(1).max(80).optional(),
    version: z.string().trim().max(40).nullable().optional(),
  })
  .refine((valor) => Boolean(valor.fuente || valor.source), { message: "fuente" });
