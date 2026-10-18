-- Migration 0245 — fix(rls): platform admin `support_readonly` não escreve nas 34 policies restantes
--
-- Segunda fatia da 0240. Porta de upstream DeskcommCRM #2115 (fatia 1 fd85bdfe3 =
-- lá 0529, fatia 2 7a396d287 + bdbc38e65 = lá 0533), adaptada ao fork: a lista de
-- upstream tem tabelas que o fork não tem (financeiro, honorários, vendas...) e
-- o fork tem policies que o upstream já reescreveu por outro caminho, então a lista
-- aqui NÃO é a de upstream — foi medida no catálogo (`pg_policies`) de um Postgres
-- efêmero com o baseline aplicado: toda policy de escrita (cmd <> SELECT) cujo
-- corpo ainda chama `fn_is_platform_admin()` (a versão que ignora o scope). Eram 34.
--
-- O furo é o mesmo da 0240: `fn_is_platform_admin()` ignora `platform_admins.scope`,
-- e `fn_support_write_allowed()` (0220) devolve `true` fora de sessão de suporte.
-- Um platform admin `support_readonly` escrevia em conversations, messages, crm_leads,
-- crm_tasks, calendar_appointments, ai_agents... de QUALQUER organização.
--
-- Conserto: cada policy é recriada com o MESMO nome, o MESMO comando e o MESMO corpo,
-- trocando só `fn_is_platform_admin()` por `fn_is_platform_admin_full()`. Verificado
-- policy a policy (tests/invariants/platform-admin-full-so-escreve-resto.test.ts):
-- o corpo novo é o antigo com essa única substituição.
--
-- Leitura intacta: as 34 tabelas têm policy SELECT própria que continua com
-- `fn_is_platform_admin()` (conferido no catálogo) — nenhuma precisa do par
-- `_read`/`_write`, e `support_readonly` segue LENDO tudo que lia. As policies SELECT
-- não são tocadas por este arquivo.
--
-- Admin `full` não perde nada (`platform_admins.scope` nasce 'full').
-- Idempotente (drop if exists + create). Nenhum dado tocado. Mesmo corpo do apêndice
-- do baseline.sql (rótulo da migration 0245); o corpo do baseline já nasce assim.

-- ---- ai_agents ----
drop policy if exists tenant_isolation_ai_agents_write on public.ai_agents;
create policy tenant_isolation_ai_agents_write on public.ai_agents
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full());

-- ---- ai_budgets ----
drop policy if exists tenant_isolation_ai_budgets_write on public.ai_budgets;
create policy tenant_isolation_ai_budgets_write on public.ai_budgets
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full());

-- ---- ai_chunks ----
drop policy if exists tenant_isolation_ai_chunks_write on public.ai_chunks;
create policy tenant_isolation_ai_chunks_write on public.ai_chunks
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full());

-- ---- ai_knowledge_sources ----
drop policy if exists tenant_isolation_ai_knowledge_sources_write on public.ai_knowledge_sources;
create policy tenant_isolation_ai_knowledge_sources_write on public.ai_knowledge_sources
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')) OR public.fn_is_platform_admin_full());

-- ---- ai_knowledge_versions ----
drop policy if exists tenant_isolation_ai_kbv_write on public.ai_knowledge_versions;
create policy tenant_isolation_ai_kbv_write on public.ai_knowledge_versions
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full());

-- ---- attendant_availability ----
drop policy if exists attendant_availability_delete on public.attendant_availability;
create policy attendant_availability_delete on public.attendant_availability
  for delete
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))));
drop policy if exists attendant_availability_insert on public.attendant_availability;
create policy attendant_availability_insert on public.attendant_availability
  for insert
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))));
drop policy if exists attendant_availability_update on public.attendant_availability;
create policy attendant_availability_update on public.attendant_availability
  for update
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))));

-- ---- automation_rules ----
drop policy if exists automation_rules_manager_write on public.automation_rules;
create policy automation_rules_manager_write on public.automation_rules
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));

-- ---- calendar_appointments ----
drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')));

-- ---- calendar_availability_exceptions ----
drop policy if exists calendar_availability_exceptions_write on public.calendar_availability_exceptions;
create policy calendar_availability_exceptions_write on public.calendar_availability_exceptions
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND ((user_id = auth.uid()) OR public.fn_role_at_least(organization_id, 'manager'))));

-- ---- calendar_event_types ----
drop policy if exists calendar_event_types_write on public.calendar_event_types;
create policy calendar_event_types_write on public.calendar_event_types
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));

-- ---- catalog_products ----
drop policy if exists catalog_products_write on public.catalog_products;
create policy catalog_products_write on public.catalog_products
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));

-- ---- channel_sessions ----
drop policy if exists channel_sessions_tenant_write on public.channel_sessions;
create policy channel_sessions_tenant_write on public.channel_sessions
  for all
  using (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full())
  with check (((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')) OR public.fn_is_platform_admin_full());

-- ---- conversation_assignment_events ----
drop policy if exists cae_insert on public.conversation_assignment_events;
create policy cae_insert on public.conversation_assignment_events
  for insert
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());

-- ---- conversations ----
drop policy if exists conversations_agent_delete on public.conversations;
create policy conversations_agent_delete on public.conversations
  for delete
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')));
drop policy if exists conversations_agent_insert on public.conversations;
create policy conversations_agent_insert on public.conversations
  for insert
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')));
drop policy if exists conversations_agent_update on public.conversations;
create policy conversations_agent_update on public.conversations
  for update
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')));

-- ---- crm_lead_activities ----
drop policy if exists crm_lead_activities_insert on public.crm_lead_activities;
create policy crm_lead_activities_insert on public.crm_lead_activities
  for insert
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());

-- ---- crm_lead_links ----
drop policy if exists crm_lead_links_delete on public.crm_lead_links;
create policy crm_lead_links_delete on public.crm_lead_links
  for delete
  using ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());
drop policy if exists crm_lead_links_insert on public.crm_lead_links;
create policy crm_lead_links_insert on public.crm_lead_links
  for insert
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());
drop policy if exists crm_lead_links_update on public.crm_lead_links;
create policy crm_lead_links_update on public.crm_lead_links
  for update
  using ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full())
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());

-- ---- crm_leads ----
drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent') AND (public.fn_role_at_least(organization_id, 'manager') OR public.fn_can_view_lead(organization_id, owner_user_id))));
drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent') AND (public.fn_role_at_least(organization_id, 'manager') OR public.fn_can_view_lead(organization_id, owner_user_id))));
drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent') AND (public.fn_role_at_least(organization_id, 'manager') OR public.fn_can_view_lead(organization_id, owner_user_id))))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent') AND (public.fn_role_at_least(organization_id, 'manager') OR public.fn_can_view_lead(organization_id, owner_user_id))));

-- ---- crm_pipelines ----
drop policy if exists crm_pipelines_manager_write on public.crm_pipelines;
create policy crm_pipelines_manager_write on public.crm_pipelines
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));

-- ---- crm_stages ----
drop policy if exists crm_stages_manager_write on public.crm_stages;
create policy crm_stages_manager_write on public.crm_stages
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));

-- ---- crm_tasks ----
drop policy if exists crm_tasks_write on public.crm_tasks;
create policy crm_tasks_write on public.crm_tasks
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'agent')));

-- ---- messages ----
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete
  using ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update
  using ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full())
  with check ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) OR public.fn_is_platform_admin_full());

-- ---- org_guardrail_layers ----
drop policy if exists org_guardrail_layers_admin_write on public.org_guardrail_layers;
create policy org_guardrail_layers_admin_write on public.org_guardrail_layers
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')));

-- ---- org_voice_calls ----
drop policy if exists org_voice_calls_admin_write on public.org_voice_calls;
create policy org_voice_calls_admin_write on public.org_voice_calls
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'admin')));

-- ---- webhook_sources ----
drop policy if exists webhook_sources_manager_write on public.webhook_sources;
create policy webhook_sources_manager_write on public.webhook_sources
  for all
  using (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin_full() OR ((organization_id IN (select public.fn_user_org_ids() as fn_user_org_ids)) AND public.fn_role_at_least(organization_id, 'manager')));
