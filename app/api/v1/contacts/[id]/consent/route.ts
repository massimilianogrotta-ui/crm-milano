import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/contacts/[id]/consent — grava concessão de marketing com carimbo.
 *
 * Não há tela obrigatória: quem coleta o sim (planilha, formulário, operador)
 * chama isto. A ausência de concessão continua não sendo recusa; quem exige
 * o sim antes de um modelo de marketing liga `require_marketing_consent`
 * nas configurações da organização.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { consentimentoBodySchema, registrarConsentimento } from "@/lib/contacts/consentimento";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  const t = (texto: string) => traduzir(texto, authz.user.idioma ?? "pt-BR");
  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("validation_failed", t("JSON inválido."), 422, { requestId });
  }
  const parsed = consentimentoBodySchema.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", t("Informe a origem do consentimento."), 422, { requestId });
  }

  const fuente = parsed.data.fuente ?? parsed.data.source ?? "";
  const canal = parsed.data.canal ?? "whatsapp";
  const supabase = await createClient();

  const { data: contato, error: leitura } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (leitura) return fail("internal_error", "internal_error", 500, { requestId });
  if (!contato) return fail("not_found", t("Contato não encontrado."), 404, { requestId });

  try {
    await registrarConsentimento(supabase, {
      organizationId: authz.org.orgId,
      contactId: id,
      canal,
      fuente,
      version: parsed.data.version ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    return fail("internal_error", "internal_error", 500, { requestId });
  }

  await audit({
    action: "contact.consent_granted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "contact",
    resourceId: id,
    requestId,
    metadata: { canal, fuente, version: parsed.data.version ?? null, actor_type: "user" },
  });

  return ok({ contact_id: id, canal, fuente }, { requestId });
}
