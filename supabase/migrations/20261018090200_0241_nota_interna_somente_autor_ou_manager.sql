-- Migration 0241 — RLS por operação em `conversation_notes`: editar/apagar só o
-- AUTOR ou manager+ (porta ADAPTADA de upstream d9c3afdfc, lá 0509, #1870).
--
-- O buraco: a escrita era uma policy única `for all` (0063) com org + papel
-- `agent`, sem distinguir o AUTOR. Qualquer `agent` da organização podia, pelo
-- PostgREST com o próprio JWT, editar ou apagar a nota interna de um colega sem
-- passar pela rota — a rota DELETE já exigia autor ou manager+ no app; o banco não.
--
-- A regra (molde da rota DELETE):
--   INSERT: org + `agent` + autor = a própria sessão (ninguém cria nota em nome
--           de outro; a rota já grava `created_by_user_id = user.id`).
--   UPDATE/DELETE: org + `agent` E (autor da nota OU manager+ da organização).
--
-- ADAPTAÇÃO: o upstream soma também `fn_can_view_conversation` (a visibilidade
-- da conversa), que vem da 0478 dele — ausente no fork. Aqui a leitura das notas
-- continua org-wide como hoje (`conversation_notes_select` não muda); portar só
-- metade da 0478 na escrita mudaria comportamento sem a leitura acompanhar.
--
-- Por operação porque `for all` concede SELECT junto e a condição de
-- UPDATE/DELETE (manager+) é diferente da de INSERT. Idempotente (drop if exists
-- + create). Nenhuma função nova, nenhum dado tocado. Mesmo corpo do apêndice do
-- baseline.sql (rótulo da migration 0241).

drop policy if exists "conversation_notes_write" on public.conversation_notes;

drop policy if exists "conversation_notes_insert" on public.conversation_notes;
create policy "conversation_notes_insert" on public.conversation_notes
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and created_by_user_id = auth.uid()
  );

drop policy if exists "conversation_notes_update" on public.conversation_notes;
create policy "conversation_notes_update" on public.conversation_notes
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "conversation_notes_delete" on public.conversation_notes;
create policy "conversation_notes_delete" on public.conversation_notes
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );
