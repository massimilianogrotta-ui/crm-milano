import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/agents/:id/versions/:vid/test (admin)
 *
 * Spec 10 §4.4. Cria ai_agent_runs com is_dry_run=true e executa o runtime
 * real (S-13.08) via `callInternalRuntime` → `runAgent`. Esse é o default.
 *
 * INTERNAL_AGENT_RUN_STUB=true troca a execução por um trace fabricado —
 * serve para exercitar o render da UI sem gastar token, e NÃO é o default:
 * numa instalação nova, "Testar agente" tem que testar o agente.
 *
 * Crítico: dry_run=true → bypass do partial unique
 *   ai_agent_runs_one_running_per_conv (que filtra is_dry_run=false), por
 *   isso múltiplos tests simultâneos pra mesma conversation não conflitam.
 *
 * Sample contact é apenas pra contexto do prompt — nunca toca contacts/conversations
 * tables, nunca chama WAHA, nunca cria messages.outbound.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { testRunSchema } from "@/lib/ai/agents/validation";
import { avaliarRespostaDeTeste } from "@/lib/ai/agents/avaliar-resposta-de-teste";
import { testAgentVersion } from "@/lib/agent-engine/agent/sandbox";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string; vid: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id, vid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(vid)) {
    return fail("invalid_request", "ids inválidos.", 400, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = testRunSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();

  const { data: version } = await admin
    .from("ai_agent_versions")
    .select(
      "id, agent_id, organization_id, system_prompt, provider, model, channel_session_id, max_steps, token_budget, cost_budget_cents, tool_ids",
    )
    .eq("id", vid)
    .eq("organization_id", activeOrg.orgId)
    .eq("agent_id", id)
    .maybeSingle();

  if (!version) return fail("not_found", t("Version não encontrada."), 404, { requestId });

  const startedAt = new Date();

  const { data: runRow, error: runErr } = await admin
    .from("ai_agent_runs")
    .insert({
      organization_id: activeOrg.orgId,
      agent_id: id,
      agent_version_id: vid,
      conversation_id: null,
      contact_id: null,
      channel_session_id: version.channel_session_id,
      inbound_message_id: null,
      outbound_message_id: null,
      status: "running",
      is_dry_run: true,
      started_at: startedAt.toISOString(),
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return fail("internal_error", "Erro ao iniciar test run.", 500, { requestId });
  }

  let resultPayload: Record<string, unknown>;

  try {
    const result = await testAgentVersion(getRequestPool(), requestTurnDeps(), {
      organizationId: activeOrg.orgId,
      agentId: id,
      versionId: vid,
      runId: runRow.id,
      sampleMessage: parsed.data.sample_message,
      sampleContact: parsed.data.sample_contact,
      channelId: version.channel_session_id,
    });
    const finalText = result.candidates.map((c) => c.body).join("\n\n");
    resultPayload = {
      run_id: runRow.id,
      status: result.candidates.length ? "ok" : "blocked",
      latency_ms: Date.now() - startedAt.getTime(),
      final_text: finalText,
      tool_calls: result.proposals,
      ...result,
      stub: process.env.INTERNAL_AGENT_RUN_STUB === "true",
      guardrails: avaliarRespostaDeTeste(finalText),
    };
    await admin
      .from("ai_agent_runs")
      .update({
        status: "ok",
        completed_at: new Date().toISOString(),
        tool_calls: JSON.parse(JSON.stringify(result.proposals)),
      })
      .eq("organization_id", activeOrg.orgId)
      .eq("id", runRow.id);
  } catch (err) {
    const error = err instanceof Error ? err : null;
    const sensitive = [
      parsed.data.sample_message,
      version.system_prompt,
      ...Object.values(parsed.data.sample_contact ?? {}),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const sanitize = (value: string) => {
      let redacted = value;
      for (const item of sensitive) redacted = redacted.replaceAll(item, "[redacted]");
      return redacted
        .replace(/(sk-[\w-]{8,}|(?:api[_-]?key|authorization|token)\s*[:=]\s*)\S+/gi, "[redacted]")
        .slice(0, 500);
    };
    const causa = sanitize(error?.message ?? String(err));
    const cause = error?.cause;
    const details = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
    logger.error("ai-agent-test: execução do teste falhou", {
      organization_id: activeOrg.orgId,
      request_id: requestId,
      agent_id: id,
      version_id: vid,
      run_id: runRow.id,
      causa,
      erro_nome: error?.name,
      ...(cause != null
        ? { causa_interna: sanitize(cause instanceof Error ? cause.message : String(cause)) }
        : {}),
      ...(details?.code != null ? { erro_codigo: sanitize(String(details.code)) } : {}),
      ...(details?.status != null ? { erro_status: sanitize(String(details.status)) } : {}),
    });
    await admin
      .from("ai_agent_runs")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        error_code: "preview_failed",
        error_message: causa.slice(0, 240),
      })
      .eq("organization_id", activeOrg.orgId)
      .eq("id", runRow.id);
    return fail(
      "preview_failed",
      t("Não foi possível executar o teste. Confira modelo, credencial e materiais do agente."),
      422,
      { requestId },
    );
  }

  void audit({
    action: "ai_agent.tested",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "ai_agent_version",
    resourceId: vid,
    requestId,
    metadata: { run_id: runRow.id, dry_run: true },
  });

  return ok(resultPayload, { requestId });
}
