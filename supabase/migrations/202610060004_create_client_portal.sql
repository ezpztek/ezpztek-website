-- EZPZTEK client invitation, approval, and modular portal access.
-- Run after 202610060002_create_admin_workspace.sql.

create table if not exists public.solution_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null check (char_length(description) <= 500),
  category text not null default 'operations'
    check (category in ('operations', 'sales', 'finance', 'people', 'insights')),
  features jsonb not null default '[]'::jsonb
    check (jsonb_typeof(features) = 'array'),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  token_hash text not null unique check (char_length(token_hash) = 64),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists client_invitations_client_created_idx
  on public.client_invitations (client_id, created_at desc);
create index if not exists client_invitations_pending_expiry_idx
  on public.client_invitations (expires_at)
  where status = 'pending';

create table if not exists public.client_portal_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid not null unique references public.clients (id) on delete cascade,
  invitation_id uuid not null unique references public.client_invitations (id),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'suspended', 'rejected')),
  registered_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_module_access (
  account_user_id uuid not null
    references public.client_portal_accounts (user_id) on delete cascade,
  module_id uuid not null references public.solution_modules (id),
  access_mode text not null default 'demo'
    check (access_mode in ('demo', 'full')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (account_user_id, module_id)
);

create index if not exists client_module_access_module_idx
  on public.client_module_access (module_id);

create or replace function public.approve_client_portal_access(
  p_account_user_id uuid,
  p_module_ids uuid[],
  p_admin_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  valid_module_count integer;
begin
  if p_module_ids is null or cardinality(p_module_ids) = 0 then
    raise exception 'Select at least one solution module';
  end if;

  select count(*) into valid_module_count
  from public.solution_modules
  where id = any(p_module_ids) and is_active = true;

  if valid_module_count <> cardinality(p_module_ids) then
    raise exception 'One or more solution modules are invalid';
  end if;

  if not exists (
    select 1 from public.client_portal_accounts
    where user_id = p_account_user_id
  ) then
    raise exception 'Client portal account not found';
  end if;

  delete from public.client_module_access
  where account_user_id = p_account_user_id;

  insert into public.client_module_access (
    account_user_id,
    module_id,
    access_mode,
    granted_by
  )
  select p_account_user_id, module_id, 'demo', p_admin_user_id
  from unnest(p_module_ids) as selected(module_id);

  update public.client_portal_accounts
  set status = 'approved',
      approved_at = now(),
      approved_by = p_admin_user_id,
      updated_at = now()
  where user_id = p_account_user_id;

  update public.clients
  set status = case when status in ('lead', 'onboarding') then 'active' else status end,
      updated_at = now()
  where id = (
    select client_id from public.client_portal_accounts
    where user_id = p_account_user_id
  );
end;
$$;

drop trigger if exists solution_modules_set_updated_at on public.solution_modules;
create trigger solution_modules_set_updated_at
before update on public.solution_modules
for each row execute function public.set_admin_workspace_updated_at();

drop trigger if exists client_portal_accounts_set_updated_at on public.client_portal_accounts;
create trigger client_portal_accounts_set_updated_at
before update on public.client_portal_accounts
for each row execute function public.set_admin_workspace_updated_at();

insert into public.solution_modules
  (code, name, description, category, features, sort_order)
values
  ('inventory', 'Inventory Management', 'Track products, movements, reorder levels, and inventory value from one workspace.', 'operations', '["Product catalog", "Stock movements", "Low-stock alerts", "Inventory valuation"]'::jsonb, 10),
  ('pos', 'Point of Sale', 'A practical checkout workspace for daily sales, receipts, discounts, and cashier activity.', 'sales', '["Fast checkout", "Receipt history", "Discount controls", "Cashier summaries"]'::jsonb, 20),
  ('stock-control', 'Item Stock Control', 'Monitor quantities by location, adjustments, transfers, and stock-taking sessions.', 'operations', '["Multi-location stock", "Adjustments", "Transfers", "Stock counts"]'::jsonb, 30),
  ('finance', 'Finance Management', 'See cash movement, operating expenses, receivables, and simple business performance.', 'finance', '["Income and expenses", "Receivables", "Cash-flow view", "Financial summaries"]'::jsonb, 40),
  ('purchasing', 'Purchasing & Suppliers', 'Organize suppliers, purchase orders, receiving, and cost history.', 'operations', '["Supplier directory", "Purchase orders", "Goods receiving", "Cost tracking"]'::jsonb, 50),
  ('crm', 'Customer Management', 'Keep customer profiles, transactions, follow-ups, and relationship notes together.', 'sales', '["Customer records", "Purchase history", "Follow-up notes", "Customer insights"]'::jsonb, 60),
  ('reports', 'Reports & Analytics', 'Turn operational data into clear dashboards and downloadable management reports.', 'insights', '["Executive dashboard", "Sales trends", "Operational reports", "Data exports"]'::jsonb, 70),
  ('staff', 'Staff & Access', 'Manage team access, roles, activity, schedules, and accountability.', 'people', '["Role-based access", "Activity history", "Staff directory", "Schedule overview"]'::jsonb, 80)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    features = excluded.features,
    sort_order = excluded.sort_order;

alter table public.solution_modules enable row level security;
alter table public.solution_modules force row level security;
alter table public.client_invitations enable row level security;
alter table public.client_invitations force row level security;
alter table public.client_portal_accounts enable row level security;
alter table public.client_portal_accounts force row level security;
alter table public.client_module_access enable row level security;
alter table public.client_module_access force row level security;

revoke all on table public.solution_modules from public, anon, authenticated, service_role;
revoke all on table public.client_invitations from public, anon, authenticated, service_role;
revoke all on table public.client_portal_accounts from public, anon, authenticated, service_role;
revoke all on table public.client_module_access from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.solution_modules to service_role;
grant select, insert, update, delete on table public.client_invitations to service_role;
grant select, insert, update, delete on table public.client_portal_accounts to service_role;
grant select, insert, update, delete on table public.client_module_access to service_role;

revoke all on function public.approve_client_portal_access(uuid, uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_client_portal_access(uuid, uuid[], uuid)
  to service_role;

comment on table public.solution_modules is 'Selectable EZPZTEK business-system modules.';
comment on table public.client_invitations is 'Single-use client credential setup invitations.';
comment on table public.client_portal_accounts is 'Authorized client identities and approval state.';
comment on table public.client_module_access is 'Modules available to each approved client account.';
