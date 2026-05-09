-- Run this once in the Supabase SQL editor (or via `supabase db push`).
-- Creates the accounts table, RLS policies, and a trigger that auto-creates
-- an account row whenever a new auth user signs up via magic link.

create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'free' check (plan in ('free', 'annual')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  export_usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

drop policy if exists "users read own account" on public.accounts;
create policy "users read own account" on public.accounts
  for select using (auth.uid() = user_id);

drop policy if exists "users update own account" on public.accounts;
create policy "users update own account" on public.accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- Increment monthly export count safely from the client (RLS-protected).
-- Returns the new count for the current month.
create or replace function public.increment_export_usage()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  month_key text := to_char(now() at time zone 'utc', 'YYYY-MM');
  current_count int;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  update public.accounts
  set export_usage = jsonb_set(
    coalesce(export_usage, '{}'::jsonb),
    array[month_key],
    to_jsonb(coalesce((export_usage ->> month_key)::int, 0) + 1)
  )
  where user_id = uid
  returning (export_usage ->> month_key)::int into current_count;

  return current_count;
end;
$$;

grant execute on function public.increment_export_usage() to authenticated;
