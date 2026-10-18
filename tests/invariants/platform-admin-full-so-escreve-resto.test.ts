/**
 * 0245 (upstream #2115, lá 0529 + 0533) — platform admin `support_readonly` não
 * escreve nas 34 policies de escrita que a 0240 deixou com `fn_is_platform_admin()`.
 *
 * `fn_is_platform_admin()` ignora o scope e `fn_support_write_allowed()` (0220)
 * devolve `true` fora de sessão de suporte, então a única barreira de um admin
 * só-leitura é a policy de escrita exigir `fn_is_platform_admin_full()`.
 *
 * Invariantes medidos em Postgres REAL:
 *   · catálogo: nenhuma policy de escrita de public usa mais a função pura
 *     (conta global — pega policy nova que reabra o furo);
 *   · catálogo: cada uma das 34 usa `_full`;
 *   · comportamento: JWT `support_readonly` altera 0 linhas nas tabelas-sonda;
 *   · CONTROLE POSITIVO: JWT `full` continua escrevendo na mesma tabela;
 *   · a LEITURA do `support_readonly` não foi tocada.
 *
 * Previsão escrita antes de rodar (sabotagem): se uma policy voltar a usar a
 * função pura, a conta global do catálogo sobe de 0 e a sonda daquela tabela
 * devolve 1 em vez de 0.
 */
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_CONTACT_1,
  GOV_CONV_UNASSIGNED,
  GOV_LEAD,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_SESSION,
  GOV_STAGE,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/** Platform admin `full` — o controle positivo que CONTINUA escrevendo. */
const FULL = "cccccccc-2450-4000-8000-000000000100";
/** Platform admin `support_readonly` — o caso que deve ficar em 0. */
const READONLY = "cccccccc-2450-4000-8000-000000000101";

/** As 34 policies de escrita fechadas pela 0245: [tabela, policy]. */
const FECHADAS: ReadonlyArray<readonly [string, string]> = [
  ["ai_agents", "tenant_isolation_ai_agents_write"],
  ["ai_budgets", "tenant_isolation_ai_budgets_write"],
  ["ai_chunks", "tenant_isolation_ai_chunks_write"],
  ["ai_knowledge_sources", "tenant_isolation_ai_knowledge_sources_write"],
  ["ai_knowledge_versions", "tenant_isolation_ai_kbv_write"],
  ["attendant_availability", "attendant_availability_delete"],
  ["attendant_availability", "attendant_availability_insert"],
  ["attendant_availability", "attendant_availability_update"],
  ["automation_rules", "automation_rules_manager_write"],
  ["calendar_appointments", "calendar_appointments_write"],
  ["calendar_availability_exceptions", "calendar_availability_exceptions_write"],
  ["calendar_event_types", "calendar_event_types_write"],
  ["catalog_products", "catalog_products_write"],
  ["channel_sessions", "channel_sessions_tenant_write"],
  ["conversation_assignment_events", "cae_insert"],
  ["conversations", "conversations_agent_delete"],
  ["conversations", "conversations_agent_insert"],
  ["conversations", "conversations_agent_update"],
  ["crm_lead_activities", "crm_lead_activities_insert"],
  ["crm_lead_links", "crm_lead_links_delete"],
  ["crm_lead_links", "crm_lead_links_insert"],
  ["crm_lead_links", "crm_lead_links_update"],
  ["crm_leads", "crm_leads_delete"],
  ["crm_leads", "crm_leads_insert"],
  ["crm_leads", "crm_leads_update"],
  ["crm_pipelines", "crm_pipelines_manager_write"],
  ["crm_stages", "crm_stages_manager_write"],
  ["crm_tasks", "crm_tasks_write"],
  ["messages", "messages_delete"],
  ["messages", "messages_insert"],
  ["messages", "messages_update"],
  ["org_guardrail_layers", "org_guardrail_layers_admin_write"],
  ["org_voice_calls", "org_voice_calls_admin_write"],
  ["webhook_sources", "webhook_sources_manager_write"],
];

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values
      ('${FULL}', 'full-0245@invariant.test'),
      ('${READONLY}', 'readonly-0245@invariant.test')
    on conflict (id) do nothing;
    delete from public.platform_admins where user_id in ('${FULL}', '${READONLY}');
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${FULL}', '${FULL}', 'full', false, 'invariante 0245'),
      ('${READONLY}', '${FULL}', 'support_readonly', false, 'invariante 0245');
  `);
});

/** Uma linha por policy de escrita (cmd <> SELECT) cujo corpo ainda chama a função pura. */
const SQL_ESCRITA_COM_FUNCAO_PURA = `
  select tablename || '.' || policyname from pg_policies
  where schemaname = 'public' and cmd <> 'SELECT'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'fn_is_platform_admin\\(\\)'
  order by 1;`;

describe("0245 — catálogo: nenhuma policy de escrita aceita a função pura", () => {
  it("conta global: 0 policies de escrita de public com fn_is_platform_admin()", () => {
    expect(sql(SQL_ESCRITA_COM_FUNCAO_PURA)).toBe("");
  });

  it.each(FECHADAS)("%s.%s existe e exige fn_is_platform_admin_full()", (tabela, policy) => {
    const corpo = sql(`
      select coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies
      where schemaname = 'public' and tablename = '${tabela}' and policyname = '${policy}';`);
    expect(corpo).toContain("fn_is_platform_admin_full()");
    expect(corpo).not.toMatch(/fn_is_platform_admin\(\)/);
    // a regra de tenant continua ali: a troca não pode ter virado "qualquer um escreve"
    expect(corpo).toMatch(/organization_id|fn_user_org_ids|fn_is_platform_admin_full/);
  });

  it("as 34 existem uma única vez (não sobrou duplicata com o nome antigo)", () => {
    const lista = FECHADAS.map(([t, p]) => `('${t}','${p}')`).join(",");
    expect(
      sql(`select count(*) from pg_policies where schemaname = 'public' and (tablename, policyname) in (${lista});`),
    ).toBe(String(FECHADAS.length));
  });
});

/**
 * Sonda de comportamento: [rótulo, dml que o admin tenta, preparação opcional
 * (roda como superusuário e devolve o id da linha criada)].
 */
function sondaInsert(rotulo: string, tabela: string, colunas: string, valores: () => string) {
  return { rotulo, tentar: () => `insert into public.${tabela} (${colunas}) values (${valores()})` };
}

const SONDAS_DE_INSERT = [
  sondaInsert(
    "crm_leads",
    "crm_leads",
    "id, organization_id, pipeline_id, stage_id, title",
    () => `'${randomUUID()}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'sonda-0245'`,
  ),
  sondaInsert("crm_tasks", "crm_tasks", "organization_id, title", () => `'${GOV_ORG}', 'sonda-0245'`),
  sondaInsert(
    "ai_agents",
    "ai_agents",
    "organization_id, name, system_prompt",
    () => `'${GOV_ORG}', 'sonda-0245-${randomUUID()}', 'x'`,
  ),
  sondaInsert(
    "calendar_event_types",
    "calendar_event_types",
    "organization_id, name, slug",
    () => `'${GOV_ORG}', 'sonda-0245', 'sonda-${randomUUID()}'`,
  ),
  sondaInsert(
    "automation_rules",
    "automation_rules",
    "organization_id, name, trigger_event",
    () => `'${GOV_ORG}', 'sonda-0245', 'conversation.created'`,
  ),
];

describe("0245 — support_readonly não INSERE (e o full continua inserindo)", () => {
  it.each(SONDAS_DE_INSERT)("$rotulo: support_readonly insere 0 linhas", ({ tentar }) => {
    expect(writeCountAs(READONLY, tentar())).toBe(0);
  });

  it.each(SONDAS_DE_INSERT)("CONTROLE POSITIVO $rotulo: o full insere 1 linha", ({ tentar }) => {
    expect(writeCountAs(FULL, tentar())).toBe(1);
  });
});

describe("0245 — messages (INSERT/UPDATE/DELETE)", () => {
  const MSG = "cccccccc-2450-4000-8000-0000000000a1";
  const linha = (id: string) =>
    `insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
     values ('${id}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${GOV_SESSION}', '${GOV_CONTACT_1}', 'text', 'inbound', 'sonda-0245')`;

  beforeAll(() => {
    sql(`${linha(MSG)} on conflict (id) do nothing;`);
  });

  it("INSERT: support_readonly é negado pela RLS (0 linhas)", () => {
    expect(writeCountAs(READONLY, linha(randomUUID()))).toBe(0);
  });

  it("INSERT: o full PASSA da RLS e só para na trigger (reserved_message_received)", () => {
    // Inbound é reservado a quem não tem auth.uid() e o full não é membro da org:
    // o insert dele nunca completa. Se a RLS o negasse, writeCountAs devolveria 0 sem
    // lançar e este caso ficaria vermelho.
    let erro = "";
    try {
      writeCountAs(FULL, linha(randomUUID()));
    } catch (err) {
      erro = (err as { stderr?: string }).stderr ?? String(err);
    }
    expect(erro).toMatch(/reserved_message_received/);
  });

  it("UPDATE: support_readonly altera 0; o full altera 1", () => {
    const dml = `update public.messages set body = 'alterada-0245' where id = '${MSG}'`;
    expect(writeCountAs(READONLY, dml)).toBe(0);
    expect(writeCountAs(FULL, dml)).toBe(1);
  });

  it("DELETE: support_readonly apaga 0; o full apaga 1", () => {
    const dml = `delete from public.messages where id = '${MSG}'`;
    expect(writeCountAs(READONLY, dml)).toBe(0);
    expect(sql(`select count(*) from public.messages where id = '${MSG}';`)).toBe("1");
    expect(writeCountAs(FULL, dml)).toBe(1);
  });
});

describe("0245 — support_readonly não ALTERA (e o full continua alterando)", () => {
  const ALTERACOES: ReadonlyArray<readonly [string, string]> = [
    ["conversations", `update public.conversations set status = 'open' where id = '${GOV_CONV_UNASSIGNED}'`],
    ["crm_leads", `update public.crm_leads set title = 'alterado-0245' where id = '${GOV_LEAD}'`],
    ["crm_pipelines", `update public.crm_pipelines set name = 'alterado-0245' where id = '${GOV_PIPELINE}'`],
    ["crm_stages", `update public.crm_stages set name = 'alterado-0245' where id = '${GOV_STAGE}'`],
    [
      "channel_sessions",
      `update public.channel_sessions set waha_session_name = waha_session_name where id = '${GOV_SESSION}'`,
    ],
  ];

  it.each(ALTERACOES)("%s: support_readonly altera 0 linhas", (_t, dml) => {
    expect(writeCountAs(READONLY, dml)).toBe(0);
  });

  it.each(ALTERACOES)("CONTROLE POSITIVO %s: o full altera 1 linha", (_t, dml) => {
    expect(writeCountAs(FULL, dml)).toBe(1);
  });
});

describe("0245 — support_readonly não APAGA (e o full continua apagando)", () => {
  function leadDescartavel(): string {
    const id = randomUUID();
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
         values ('${id}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'descartavel-0245');`);
    return id;
  }

  it("crm_leads: support_readonly apaga 0 linhas", () => {
    const id = leadDescartavel();
    expect(writeCountAs(READONLY, `delete from public.crm_leads where id = '${id}'`)).toBe(0);
    expect(sql(`select count(*) from public.crm_leads where id = '${id}';`)).toBe("1");
  });

  it("CONTROLE POSITIVO crm_leads: o full apaga 1 linha", () => {
    const id = leadDescartavel();
    expect(writeCountAs(FULL, `delete from public.crm_leads where id = '${id}'`)).toBe(1);
  });
});

describe("0245 — a LEITURA do support_readonly não foi tocada", () => {
  it.each([
    ["conversations", `select count(*) from public.conversations where id = '${GOV_CONV_UNASSIGNED}';`],
    ["crm_leads", `select count(*) from public.crm_leads where id = '${GOV_LEAD}';`],
    ["crm_pipelines", `select count(*) from public.crm_pipelines where id = '${GOV_PIPELINE}';`],
    ["crm_stages", `select count(*) from public.crm_stages where id = '${GOV_STAGE}';`],
    ["channel_sessions", `select count(*) from public.channel_sessions where id = '${GOV_SESSION}';`],
  ])("%s: support_readonly continua lendo a linha da outra organização", (_t, consulta) => {
    expect(countAs(READONLY, consulta)).toBe(1);
  });
});
