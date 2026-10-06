-- EZPZTEK admin workspace
-- Run after 202610060001_create_consultation_requests.sql.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  role text not null default 'admin'
    check (role in ('owner', 'admin', 'support')),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  price_centavos bigint check (price_centavos is null or price_centavos >= 0),
  billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'yearly', 'custom')),
  features jsonb not null default '[]'::jsonb
    check (jsonb_typeof(features) = 'array'),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null
    check (char_length(btrim(business_name)) between 2 and 140),
  contact_name text not null
    check (char_length(btrim(contact_name)) between 2 and 100),
  contact_email text not null
    check (char_length(contact_email) between 3 and 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 32),
  website text check (website is null or char_length(website) <= 240),
  status text not null default 'lead'
    check (status in ('lead', 'onboarding', 'active', 'paused', 'cancelled')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status text not null default 'active'
    check (status in ('trial', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  amount_centavos bigint check (amount_centavos is null or amount_centavos >= 0),
  starts_at date not null default current_date,
  renews_at date,
  ends_at date,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists client_subscriptions_one_current_idx
  on public.client_subscriptions (client_id)
  where status in ('trial', 'active', 'past_due', 'paused');

create index if not exists clients_status_created_at_idx
  on public.clients (status, created_at desc);

create index if not exists client_subscriptions_renews_at_idx
  on public.client_subscriptions (renews_at)
  where status in ('trial', 'active', 'past_due');

create or replace function public.replace_client_subscription(
  p_client_id uuid,
  p_plan_id uuid,
  p_status text,
  p_amount_centavos bigint,
  p_starts_at date,
  p_renews_at date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_subscription_id uuid;
begin
  if p_status not in ('trial', 'active', 'past_due', 'paused') then
    raise exception 'Invalid current subscription status';
  end if;

  update public.client_subscriptions
  set status = 'cancelled', ends_at = p_starts_at
  where client_id = p_client_id
    and status in ('trial', 'active', 'past_due', 'paused');

  insert into public.client_subscriptions (
    client_id,
    plan_id,
    status,
    amount_centavos,
    starts_at,
    renews_at
  ) values (
    p_client_id,
    p_plan_id,
    p_status,
    p_amount_centavos,
    p_starts_at,
    p_renews_at
  ) returning id into new_subscription_id;

  return new_subscription_id;
end;
$$;

create table if not exists public.admin_activity_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 2 and 80),
  entity_type text not null check (char_length(entity_type) between 2 and 60),
  entity_id text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.consultation_requests
  add column if not exists admin_notes text
    check (admin_notes is null or char_length(admin_notes) <= 4000);

create or replace function public.set_admin_workspace_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
before update on public.admin_users
for each row execute function public.set_admin_workspace_updated_at();

drop trigger if exists subscription_plans_set_updated_at on public.subscription_plans;
create trigger subscription_plans_set_updated_at
before update on public.subscription_plans
for each row execute function public.set_admin_workspace_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_admin_workspace_updated_at();

drop trigger if exists client_subscriptions_set_updated_at on public.client_subscriptions;
create trigger client_subscriptions_set_updated_at
before update on public.client_subscriptions
for each row execute function public.set_admin_workspace_updated_at();

insert into public.subscription_plans
  (code, name, description, price_centavos, billing_interval, features, sort_order)
values
  (
    'starter',
    'Starter',
    'A focused system for a small team replacing manual tracking.',
    149900,
    'monthly',
    '["Up to 5 team members", "Core workflow dashboard", "Email support"]'::jsonb,
    10
  ),
  (
    'growth',
    'Growth',
    'More automation, reporting, and room for a growing operation.',
    349900,
    'monthly',
    '["Up to 20 team members", "Advanced reports", "Priority support"]'::jsonb,
    20
  ),
  (
    'custom',
    'Custom Build',
    'Custom software scoped around a client’s exact process.',
    null,
    'custom',
    '["Custom modules", "Implementation planning", "Dedicated support"]'::jsonb,
    30
  )
on conflict (code) do nothing;

-- All admin workspace data is accessed through authenticated server actions.
-- Browser roles receive no direct table access.
alter table public.admin_users enable row level security;
alter table public.admin_users force row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_plans force row level security;
alter table public.clients enable row level security;
alter table public.clients force row level security;
alter table public.client_subscriptions enable row level security;
alter table public.client_subscriptions force row level security;
alter table public.admin_activity_log enable row level security;
alter table public.admin_activity_log force row level security;

revoke all on table public.admin_users from public, anon, authenticated, service_role;
revoke all on table public.subscription_plans from public, anon, authenticated, service_role;
revoke all on table public.clients from public, anon, authenticated, service_role;
revoke all on table public.client_subscriptions from public, anon, authenticated, service_role;
revoke all on table public.admin_activity_log from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.admin_users to service_role;
grant select, insert, update, delete on table public.subscription_plans to service_role;
grant select, insert, update, delete on table public.clients to service_role;
grant select, insert, update, delete on table public.client_subscriptions to service_role;
grant select, insert on table public.admin_activity_log to service_role;
grant usage, select on sequence public.admin_activity_log_id_seq to service_role;

revoke all on function public.set_admin_workspace_updated_at()
  from public, anon, authenticated, service_role;
grant execute on function public.set_admin_workspace_updated_at() to service_role;

revoke all on function public.replace_client_subscription(uuid, uuid, text, bigint, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_client_subscription(uuid, uuid, text, bigint, date, date)
  to service_role;

comment on table public.admin_users is 'Authorized EZPZTEK back-office users.';
comment on table public.clients is 'EZPZTEK client accounts and lifecycle status.';
comment on table public.client_subscriptions is 'Subscription history for EZPZTEK clients.';
