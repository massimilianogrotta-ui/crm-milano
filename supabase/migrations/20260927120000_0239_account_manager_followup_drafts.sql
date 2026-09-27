-- 0239 · account_manager_followup_drafts
-- Bozze di follow-up scritte dall'agente «Account manager» via API riservata
-- (/api/v1/account-manager/*). SOLO bozze: nessun worker, trigger o rotta legge
-- questa tabella per inviare. Un umano la legge e, se vuole, scrive lui il messaggio.
-- Lettura per tutta l'org, scrittura a ruoli (forma 0238). Idempotente.

create table if not exists public.account_manager_followup_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  channel text not null default 'email' check (channel in ('email', 'whatsapp', 'altro')),
  subject text check (subject is null or char_length(subject) <= 300),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'archived')),
  created_by_api_token_id uuid references public.api_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_am_followup_drafts_contact
  on public.account_manager_followup_drafts(organization_id, contact_id, created_at desc);

alter table public.account_manager_followup_drafts enable row level security;
revoke all on public.account_manager_followup_drafts from anon;

drop policy if exists am_followup_drafts_select on public.account_manager_followup_drafts;
drop policy if exists am_followup_drafts_write on public.account_manager_followup_drafts;

create policy am_followup_drafts_select on public.account_manager_followup_drafts for select
  using (organization_id in (select public.fn_user_org_ids()));

create policy am_followup_drafts_write on public.account_manager_followup_drafts for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );
