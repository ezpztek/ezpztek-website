-- Automatically promote qualified consultation inquiries into client records.
-- Run after 202610060002_create_admin_workspace.sql.

create table if not exists public.client_inquiry_links (
  inquiry_id uuid primary key
    references public.consultation_requests (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  linked_at timestamptz not null default now()
);

create index if not exists client_inquiry_links_client_idx
  on public.client_inquiry_links (client_id);

create or replace function public.promote_qualified_inquiry_to_client(
  p_inquiry_id uuid,
  p_admin_user_id uuid
)
returns table (client_id uuid, created boolean)
language plpgsql
set search_path = ''
as $$
declare
  inquiry_record public.consultation_requests%rowtype;
  existing_client_id uuid;
  new_client_id uuid;
begin
  select * into inquiry_record
  from public.consultation_requests
  where id = p_inquiry_id
  for update;

  if inquiry_record.id is null then
    raise exception 'Inquiry not found';
  end if;

  if inquiry_record.status <> 'qualified' then
    raise exception 'Only qualified inquiries can be promoted';
  end if;

  select link.client_id into existing_client_id
  from public.client_inquiry_links as link
  where link.inquiry_id = p_inquiry_id;

  if existing_client_id is not null then
    return query select existing_client_id, false;
    return;
  end if;

  select existing.id into existing_client_id
  from public.clients as existing
  where lower(existing.contact_email) = lower(inquiry_record.email)
  order by
    (lower(existing.business_name) = lower(inquiry_record.business_name)) desc,
    existing.created_at asc
  limit 1;

  if existing_client_id is null then
    insert into public.clients (
      business_name,
      contact_name,
      contact_email,
      contact_phone,
      status,
      notes
    ) values (
      inquiry_record.business_name,
      inquiry_record.name,
      lower(inquiry_record.email),
      inquiry_record.phone,
      'lead',
      left('Qualified consultation inquiry:' || E'\n' || inquiry_record.message, 4000)
    )
    returning id into new_client_id;
  else
    new_client_id := existing_client_id;

    update public.clients
    set contact_phone = coalesce(contact_phone, inquiry_record.phone),
        updated_at = now()
    where id = new_client_id;
  end if;

  insert into public.client_inquiry_links (inquiry_id, client_id)
  values (p_inquiry_id, new_client_id)
  on conflict (inquiry_id) do nothing;

  insert into public.admin_activity_log (
    admin_user_id,
    action,
    entity_type,
    entity_id,
    details
  ) values (
    p_admin_user_id,
    'inquiry.promoted_to_client',
    'client',
    new_client_id::text,
    jsonb_build_object(
      'inquiryId', p_inquiry_id,
      'createdClient', existing_client_id is null
    )
  );

  return query select new_client_id, existing_client_id is null;
end;
$$;

create or replace function public.sync_qualified_inquiries_to_clients(
  p_admin_user_id uuid
)
returns table (processed integer, clients_created integer, clients_linked integer)
language plpgsql
set search_path = ''
as $$
declare
  inquiry_record record;
  promotion_record record;
  processed_count integer := 0;
  created_count integer := 0;
  linked_count integer := 0;
begin
  for inquiry_record in
    select inquiry.id
    from public.consultation_requests as inquiry
    left join public.client_inquiry_links as link on link.inquiry_id = inquiry.id
    where inquiry.status = 'qualified' and link.inquiry_id is null
    order by inquiry.created_at asc
  loop
    select * into promotion_record
    from public.promote_qualified_inquiry_to_client(
      inquiry_record.id,
      p_admin_user_id
    );

    processed_count := processed_count + 1;
    if promotion_record.created then
      created_count := created_count + 1;
    else
      linked_count := linked_count + 1;
    end if;
  end loop;

  return query select processed_count, created_count, linked_count;
end;
$$;

alter table public.client_inquiry_links enable row level security;
alter table public.client_inquiry_links force row level security;

revoke all on table public.client_inquiry_links
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.client_inquiry_links
  to service_role;

revoke all on function public.promote_qualified_inquiry_to_client(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.promote_qualified_inquiry_to_client(uuid, uuid)
  to service_role;

revoke all on function public.sync_qualified_inquiries_to_clients(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_qualified_inquiries_to_clients(uuid)
  to service_role;

comment on table public.client_inquiry_links is
  'Idempotent link between a qualified inquiry and its client record.';
