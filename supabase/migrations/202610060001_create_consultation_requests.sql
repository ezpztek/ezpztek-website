-- EZPZTEK website consultation inquiries
-- Run this in the Supabase SQL Editor or apply it with the Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  request_fingerprint text not null
    check (char_length(request_fingerprint) = 64),
  name text not null
    check (char_length(btrim(name)) between 2 and 100),
  business_name text not null
    check (char_length(btrim(business_name)) between 2 and 120),
  email text not null
    check (char_length(email) between 3 and 254),
  phone text
    check (phone is null or char_length(phone) between 1 and 32),
  message text not null
    check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  source text not null default 'website'
    check (source in ('website', 'manual', 'referral')),
  confirmation_status text not null default 'pending'
    check (confirmation_status in ('pending', 'sent', 'failed')),
  confirmation_sent_at timestamptz,
  owner_notification_status text not null default 'pending'
    check (owner_notification_status in ('pending', 'sent', 'failed')),
  owner_notification_sent_at timestamptz,
  email_attempts smallint not null default 0
    check (email_attempts >= 0),
  last_email_error_code text
    check (
      last_email_error_code is null
      or char_length(last_email_error_code) <= 80
    ),
  consent_at timestamptz not null default now(),
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_requests_created_at_idx
  on public.consultation_requests (created_at desc);

create index if not exists consultation_requests_status_created_at_idx
  on public.consultation_requests (status, created_at desc);

create index if not exists consultation_requests_email_created_at_idx
  on public.consultation_requests (lower(email), created_at desc);

create index if not exists consultation_requests_fingerprint_created_at_idx
  on public.consultation_requests (request_fingerprint, created_at desc);

create or replace function public.set_consultation_request_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists consultation_requests_set_updated_at
  on public.consultation_requests;

create trigger consultation_requests_set_updated_at
before update on public.consultation_requests
for each row
execute function public.set_consultation_request_updated_at();

-- Inquiries are accepted only through the server-side Next.js route.
-- No anon or authenticated RLS policy is intentionally created.
alter table public.consultation_requests enable row level security;
alter table public.consultation_requests force row level security;

revoke all on table public.consultation_requests
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.consultation_requests
  to service_role;

revoke all on function public.set_consultation_request_updated_at()
  from public, anon, authenticated, service_role;
grant execute on function public.set_consultation_request_updated_at()
  to service_role;

comment on table public.consultation_requests is
  'Consultation requests submitted through the EZPZTEK website.';
