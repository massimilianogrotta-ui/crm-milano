-- Migration 0242 — o portão de anonimizar contato exige platform admin `full`
-- (porta ADAPTADA de upstream 3dbbd493e, lá 0532; mesma classe da 0240).
--
-- `fn_lgpd_anonymize_contact` é `security definer`, concedida a `authenticated`.
-- O portão aceitava `(fn_is_platform_admin() and support is null)`, e
-- `fn_is_platform_admin()` ignora `platform_admins.scope`: um platform admin
-- `support_readonly`, fora de sessão de suporte, anonimizava (de forma
-- IRREVERSÍVEL) contato de qualquer organização chamando o RPC direto.
-- `fn_support_write_allowed()` não fecha isso: sem sessão de suporte ela é `true`.
--
-- ADAPTAÇÃO: o corpo é o do FORK (0229), não o do upstream — lá a função passou a
-- delegar a redação a `fn_lgpd_cascade_redact_contact` (#1504), mudança que o
-- fork não tem. A ÚNICA troca é `fn_is_platform_admin()` →
-- `fn_is_platform_admin_full()` (criada na 0240). Admin `full` fora de suporte
-- segue anonimizando; o modo de leitura não escreve por caminho nenhum.
--
-- Mesmo corpo do apêndice do baseline.sql (rótulo da migration 0242); grants
-- reaplicados como na 0229.

create or replace function public.fn_lgpd_anonymize_contact(p_organization_id uuid,p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.contacts; support jsonb;
begin
 support:=public.fn_support_context();
 if auth.uid() is null or not public.fn_support_write_allowed(p_organization_id)
  or not (public.fn_role_at_least(p_organization_id,'admin') or (public.fn_is_platform_admin_full() and support is null)) then
  raise exception 'contact_anonymize_forbidden' using errcode='42501';
 end if;
 if not public.fn_session_mfa_proven() then raise exception 'contact_anonymize_mfa_required' using errcode='42501';end if;
 perform public.fn_service_lock(p_organization_id,p_contact_id);
 select * into c from public.contacts where organization_id=p_organization_id and id=p_contact_id for update;
 if not found then raise exception 'contact_not_found' using errcode='P0002';end if;
 if c.is_anonymized then return jsonb_build_object('already_anonymized',true,'anonymized_at',c.anonymized_at);end if;
 update public.contacts set name=null,display_name='Contato Anonimizado #'||substring(p_contact_id::text from 1 for 8),
  email=null,phone_number=null,cpf_encrypted=null,cpf_hash=null,birthdate=null,
  is_anonymized=true,anonymized_at=now(),updated_at=now()
  where organization_id=p_organization_id and id=p_contact_id returning * into c;
 return jsonb_build_object('already_anonymized',false,'anonymized_at',c.anonymized_at);
end;$$;
revoke all on function public.fn_lgpd_anonymize_contact(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fn_lgpd_anonymize_contact(uuid,uuid) to authenticated;
