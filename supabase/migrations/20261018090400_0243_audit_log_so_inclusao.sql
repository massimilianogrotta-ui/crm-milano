-- Migration 0243 — o audit log é só-inclusão para todo papel que não seja o dono
-- (porta de upstream 0258 + 0525, com os dois corpos juntos).
--
-- ─── O problema ─────────────────────────────────────────────────────────────
-- Todo projeto Supabase nasce com um default ACL de TABELAS em `public`
-- (`anon=arwdDxt`, `authenticated=arwdDxt`, `service_role=arwdDxt`). Então
-- `api_audit_log` nasce com UPDATE, DELETE e TRUNCATE para os três papéis do
-- PostgREST, e o `GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE` do dump só
-- acrescenta. Com a service key (que ignora RLS) uma linha escolhida da
-- auditoria podia ser apagada ou reescrita pela REST; TRUNCATE esvaziava tudo
-- sem passar por RLS. O comentário da tabela dizia "append-only" — era prosa.
--
-- ─── Por que revogar não quebra ninguém no fork ─────────────────────────────
-- Conferido no código do fork: nenhum caminho de produto faz UPDATE/DELETE em
-- `api_audit_log` pelos papéis do PostgREST (só `insert` e `select`). O único
-- apagamento é `fn_expurgar_auditoria_vencida` (0167), `security definer` de
-- dono `postgres`; as FKs `on delete set null` rodam como o dono da tabela. O
-- único `delete` fora disso era o seed de e2e (`scripts/seed-e2e-capacidades.ts`),
-- ajustado no mesmo commit como no upstream.
--
-- ─── Duas partes ────────────────────────────────────────────────────────────
-- 1. (upstream 0258) revoke da lista fixa: public, anon, authenticated, service_role.
-- 2. (upstream 0525) todo OUTRO papel com grant direto de UPDATE/DELETE/TRUNCATE,
--    exceto o dono, perde os três — o guia do self-host manda criar um
--    `agent_worker` com DML em todas as tabelas. INSERT e SELECT ficam.
--
-- Idempotente: revoke do que não existe é no-op e o laço não acha ninguém na
-- segunda passada. Mesmo corpo do apêndice do baseline.sql (rótulo 0243).

revoke update, delete, truncate on table public.api_audit_log
  from public, anon, authenticated, service_role;

do $$
declare
  v_papel text;
begin
  for v_papel in
    select distinct case when a.grantee = 0 then 'public' else quote_ident(r.rolname) end
      from pg_class c
      cross join lateral aclexplode(c.relacl) a
      left join pg_roles r on r.oid = a.grantee
     where c.oid = 'public.api_audit_log'::regclass
       and a.grantee <> c.relowner
       and a.privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
  loop
    execute format('revoke update, delete, truncate on table public.api_audit_log from %s', v_papel);
  end loop;
end
$$;

comment on table public.api_audit_log is
  'L-10: Append-only para todo papel que não seja o dono — anon, authenticated, service_role e papéis do operador não têm UPDATE, DELETE nem TRUNCATE (migration 0243; o default ACL do Supabase concedia os três). O único apagamento é fn_expurgar_auditoria_vencida (0167), security definer com piso de 90 dias no corpo. Retenção default 5 anos.';

notify pgrst, 'reload schema';
