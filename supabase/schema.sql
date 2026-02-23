-- Echo MVP cloud state table (quick migration from localStorage)
create table if not exists public.app_state (
  id bigserial primary key,
  owner text not null,
  scope text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner, scope)
);

create index if not exists idx_app_state_owner on public.app_state(owner);
create index if not exists idx_app_state_scope on public.app_state(scope);

-- Keep updated_at fresh on every update
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_state_updated_at on public.app_state;
create trigger trg_app_state_updated_at
before update on public.app_state
for each row
execute function public.set_updated_at();

-- RLS locked down: client anon access is denied.
-- App reads/writes through secure server API using service role key.
alter table public.app_state enable row level security;

drop policy if exists "app_state_select_all" on public.app_state;
drop policy if exists "app_state_insert_all" on public.app_state;
drop policy if exists "app_state_update_all" on public.app_state;
drop policy if exists "app_state_select_none" on public.app_state;
create policy "app_state_select_none"
on public.app_state
for select
using (false);

drop policy if exists "app_state_insert_none" on public.app_state;
create policy "app_state_insert_none"
on public.app_state
for insert
with check (false);

drop policy if exists "app_state_update_none" on public.app_state;
create policy "app_state_update_none"
on public.app_state
for update
using (false)
with check (false);
