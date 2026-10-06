-- Rate limiting for server-side emergency owner access.

create table if not exists public.admin_emergency_login_attempts (
  request_fingerprint text primary key
    check (char_length(request_fingerprint) = 64),
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 6),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_admin_emergency_attempt(
  p_fingerprint text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.admin_emergency_login_attempts%rowtype;
  v_now timestamptz := now();
begin
  if p_fingerprint is null or char_length(p_fingerprint) <> 64 then
    raise exception 'Invalid request fingerprint';
  end if;

  insert into public.admin_emergency_login_attempts (request_fingerprint)
  values (p_fingerprint)
  on conflict (request_fingerprint) do nothing;

  select * into attempt
  from public.admin_emergency_login_attempts
  where request_fingerprint = p_fingerprint
  for update;

  if attempt.locked_until is not null and attempt.locked_until > v_now then
    return query select false,
      greatest(1, ceil(extract(epoch from (attempt.locked_until - v_now)))::integer);
    return;
  end if;

  if attempt.window_started_at <= v_now - interval '15 minutes' then
    attempt.attempt_count := 1;
    attempt.window_started_at := v_now;
    attempt.locked_until := null;
  else
    attempt.attempt_count := attempt.attempt_count + 1;
  end if;

  if attempt.attempt_count > 5 then
    attempt.attempt_count := 6;
    attempt.locked_until := v_now + interval '15 minutes';
  end if;

  update public.admin_emergency_login_attempts
  set attempt_count = attempt.attempt_count,
      window_started_at = attempt.window_started_at,
      locked_until = attempt.locked_until,
      updated_at = v_now
  where request_fingerprint = p_fingerprint;

  if attempt.locked_until is not null then
    return query select false,
      greatest(1, ceil(extract(epoch from (attempt.locked_until - v_now)))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

alter table public.admin_emergency_login_attempts enable row level security;
alter table public.admin_emergency_login_attempts force row level security;

revoke all on table public.admin_emergency_login_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.admin_emergency_login_attempts
  to service_role;

revoke all on function public.consume_admin_emergency_attempt(text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_admin_emergency_attempt(text)
  to service_role;

comment on table public.admin_emergency_login_attempts is
  'Short-lived server-side throttling state for emergency owner PIN access.';
