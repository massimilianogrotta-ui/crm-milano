-- ============================================================================
-- 0237 — TIPOS DE AGENDAMENTO NASCIAM SEMPRE EM PORTUGUÊS
--
-- A 0185 semeia 3 tipos neutros (Consulta, Reunião, Atendimento) em toda
-- organização nova, via trigger em `organizations` — ver comentário completo
-- lá. O nome ficava fixo em português mesmo quando `organizations.locale`
-- (coluna já existente, populada pelo instalador) resolvia outra língua: uma
-- instalação em `it` ou `es` nascia com "Reunião" na Agenda, e só se
-- descobria manualmente — não é o que a doutrina de localização promete.
--
-- Medido no cliente All-io (locale `it`, currency ainda `BRL`): os 3 tipos
-- tinham nascido em português, e a moeda da org nunca tinha sido corrigida
-- para EUR. As duas causas são a mesma classe de bug — seed que não lê o
-- locale/moeda que já estava disponível no momento do INSERT.
--
-- ─── O que muda ────────────────────────────────────────────────────────────
-- 1. `fn_semear_tipos_de_agendamento` passa a olhar `organizations.locale` da
--    própria organização e escolher o nome traduzido (pt-BR/es/it/en) — mesmo
--    padrão já usado em `createDefaultAgent.ts` para o system_prompt do
--    agente padrão.
-- 2. Backfill idempotente: corrige o `name` dos 3 tipos SEMEADOS por padrão
--    (identificados pelo `slug`, que não muda) em organizações cujo locale
--    não é pt-BR — mas só quando o nome ainda é EXATAMENTE um dos 3
--    originais, nunca sobrescrevendo o que o dono já renomeou (mesma cautela
--    do `on conflict do nothing` da 0185).
-- ============================================================================

create or replace function public.fn_semear_tipos_de_agendamento(p_organization_id uuid)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_criados integer := 0;
  v_locale text;
  r record;
begin
  select locale into v_locale from public.organizations where id = p_organization_id;

  for r in
    select * from (values
      ('consulta',    'consulta',    30, 1000::numeric),
      ('reuniao',     'reuniao',     30, 2000::numeric),
      ('atendimento', 'outro',       30, 3000::numeric)
    ) as t(slug, categoria, duracao, posicao)
  loop
    insert into public.calendar_event_types
      (organization_id, name, slug, category, duration_minutes, position)
    values
      (
        p_organization_id,
        case r.slug
          when 'consulta' then
            case coalesce(v_locale, 'pt-BR')
              when 'es' then 'Consulta'
              when 'it' then 'Consulenza'
              when 'en' then 'Consultation'
              else 'Consulta'
            end
          when 'reuniao' then
            case coalesce(v_locale, 'pt-BR')
              when 'es' then 'Reunión'
              when 'it' then 'Riunione'
              when 'en' then 'Meeting'
              else 'Reunião'
            end
          else
            case coalesce(v_locale, 'pt-BR')
              when 'es' then 'Atención'
              when 'it' then 'Assistenza'
              when 'en' then 'Service'
              else 'Atendimento'
            end
        end,
        r.slug,
        r.categoria,
        r.duracao,
        r.posicao
      )
    on conflict (organization_id, slug) do nothing;

    if found then
      v_criados := v_criados + 1;
    end if;
  end loop;

  return v_criados;
end;
$$;

comment on function public.fn_semear_tipos_de_agendamento(uuid) is
  'O PISO da agenda: três tipos neutros (Consulta, Reunião, Atendimento) para que instalação fresca tenha o que marcar, traduzidos conforme organizations.locale. Não é o teto — o enriquecimento por nicho vive no passo do funil do onboarding, onde o nicho existe. `on conflict do nothing` para nunca sobrescrever o que o dono editou.';

-- Backfill: organizações que JÁ receberam o seed em português, mas cujo
-- locale não é pt-BR, e cujo nome ainda é EXATAMENTE o original (dono nunca
-- renomeou). Guardado por igualdade de nome — não idempotente por acidente,
-- por desenho: rodar de novo não muda nada, porque o nome já terá mudado.
update public.calendar_event_types t
set name = case t.slug
    when 'consulta' then
      case o.locale when 'es' then 'Consulta' when 'it' then 'Consulenza' when 'en' then 'Consultation' else t.name end
    when 'reuniao' then
      case o.locale when 'es' then 'Reunión' when 'it' then 'Riunione' when 'en' then 'Meeting' else t.name end
    when 'atendimento' then
      case o.locale when 'es' then 'Atención' when 'it' then 'Assistenza' when 'en' then 'Service' else t.name end
    else t.name
  end
from public.organizations o
where o.id = t.organization_id
  and o.locale <> 'pt-BR'
  and t.slug in ('consulta', 'reuniao', 'atendimento')
  and t.name in ('Consulta', 'Reunião', 'Atendimento');

notify pgrst, 'reload schema';
