-- Delivery onboarding and durable inbox. All data remains server-only.
begin;
create table public.delivery_provider_settings (
  provider text primary key check (provider = 'foodpanda'),
  production_enabled boolean not null default false,
  approved_at timestamptz,
  check (not production_enabled or approved_at is not null)
);
insert into public.delivery_provider_settings(provider) values ('foodpanda');

create table public.delivery_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  branch_id uuid not null,
  provider text not null default 'foodpanda' check (provider = 'foodpanda'),
  environment text not null check (environment in ('sandbox', 'staging', 'production')),
  status text not null default 'requested' check (status in ('requested', 'active', 'disconnected')),
  remote_store_id text not null default gen_random_uuid()::text
    check (length(remote_store_id) between 1 and 120),
  vendor_code text check (length(btrim(vendor_code)) between 1 and 120),
  chain_code text check (length(btrim(chain_code)) between 1 and 120),
  country_code text not null default 'PH' check (country_code = 'PH'),
  integration_flow text not null default 'indirect' check (integration_flow = 'indirect'),
  consent_by uuid not null references auth.users(id),
  consent_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, branch_id, id),
  unique (provider, environment, remote_store_id),
  unique (client_id, branch_id, provider, environment),
  foreign key (client_id, branch_id) references public.client_branches(client_id, id),
  check (environment = 'sandbox' or status <> 'active'
    or (verified_at is not null and vendor_code is not null and chain_code is not null))
);
create unique index delivery_vendor_binding
  on public.delivery_connections(provider, environment, country_code, vendor_code)
  where vendor_code is not null and status = 'active';
create function public.protect_delivery_connection_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.client_id,new.branch_id,new.provider,new.environment,new.remote_store_id)
    is distinct from (old.client_id,old.branch_id,old.provider,old.environment,old.remote_store_id) then
    raise exception 'CONNECTION_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger delivery_connection_identity before update on public.delivery_connections
  for each row execute function public.protect_delivery_connection_identity();

create table public.delivery_product_mappings (
  client_id uuid not null,
  branch_id uuid not null,
  connection_id uuid not null,
  external_product_id text not null check (length(btrim(external_product_id)) between 1 and 120),
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (connection_id, external_product_id),
  foreign key (client_id,branch_id,connection_id) references public.delivery_connections(client_id,branch_id,id),
  foreign key (client_id,branch_id,product_id) references public.inventory_products(client_id,branch_id,id)
);
create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  branch_id uuid not null,
  connection_id uuid not null,
  event_key text not null check (length(event_key) between 1 and 120),
  external_order_id text not null check (length(external_order_id) between 1 and 120),
  payload jsonb not null check (pg_column_size(payload) <= 65536),
  status text not null default 'pending' check (status in ('pending','processed','retry','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id,event_key),
  foreign key (client_id,branch_id,connection_id) references public.delivery_connections(client_id,branch_id,id)
);
create index delivery_events_pending on public.delivery_events(next_attempt_at,received_at)
  where status in ('pending','retry');
create index delivery_events_client on public.delivery_events(client_id,received_at desc);
create index delivery_events_rate on public.delivery_events(connection_id,received_at desc);

create table public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  branch_id uuid not null,
  connection_id uuid not null,
  external_order_id text not null,
  status text not null default 'received'
    check (status in ('received','accepted','preparing','ready','picked_up','cancelled','rejected')),
  status_at timestamptz not null default '1970-01-01T00:00:00Z',
  snapshot jsonb,
  total_centavos bigint not null default 0 check (total_centavos between 0 and 1000000000000),
  collection text not null default 'unknown' check (collection in ('platform','merchant','unknown')),
  inventory_state text not null default 'none'
    check (inventory_state in ('none','deducted','review','restocked','consumed')),
  sale_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id,external_order_id),
  unique (client_id,branch_id,id),
  foreign key (client_id,branch_id,connection_id) references public.delivery_connections(client_id,branch_id,id),
  foreign key (client_id,branch_id,sale_id) references public.pos_sales(client_id,branch_id,id)
);
create index delivery_orders_client on public.delivery_orders(client_id,created_at desc);
create table public.delivery_order_items (
  order_id uuid not null,
  client_id uuid not null,
  branch_id uuid not null,
  line_number integer not null,
  product_id uuid not null,
  external_product_id text not null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 10000),
  unit_price_centavos bigint not null check (unit_price_centavos between 0 and 1000000000000),
  primary key (order_id,line_number),
  foreign key (client_id,branch_id,order_id) references public.delivery_orders(client_id,branch_id,id),
  foreign key (client_id,branch_id,product_id) references public.inventory_products(client_id,branch_id,id)
);
create table public.delivery_audit (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id),
  actor_user_id uuid references auth.users(id),
  action text not null check (length(action) between 1 and 100),
  entity_id uuid,
  created_at timestamptz not null default now()
);
create function public.audit_delivery_connection()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.delivery_audit(client_id,actor_user_id,action,entity_id)
    values (new.client_id,case when TG_OP='INSERT' then new.consent_by end,
      'connection_'||lower(TG_OP)||'_'||new.status,new.id);
  return new;
end;
$$;
create trigger delivery_connection_audit after insert or update on public.delivery_connections
  for each row execute function public.audit_delivery_connection();

create function public.enqueue_delivery_event(p_connection_id uuid,p_event jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  c public.delivery_connections%rowtype;
  existing public.delivery_events%rowtype;
  event_uuid uuid;
begin
  -- Serializes duplicate-key checking and the simulator's per-store rate limit.
  select * into c from public.delivery_connections where id=p_connection_id for update;
  if not found then raise exception 'CONNECTION_UNAVAILABLE'; end if;
  if jsonb_typeof(p_event) is distinct from 'object'
    or (p_event - array['schemaVersion','eventId','occurredAt','remoteStoreId','orderId','status','order']) <> '{}'::jsonb
    or p_event->>'schemaVersion' is distinct from '1'
    or p_event->>'remoteStoreId' is distinct from c.remote_store_id
    or nullif(p_event->>'eventId','') is null or nullif(p_event->>'orderId','') is null then
    raise exception 'INVALID_EVENT';
  end if;
  if p_event->>'status' is null or p_event->>'status'
    not in ('received','accepted','preparing','ready','picked_up','cancelled','rejected') then
    raise exception 'INVALID_STATUS';
  end if;
  if c.environment <> 'sandbox' and not exists (
    select 1 from public.delivery_provider_settings where provider=c.provider and production_enabled
  ) then raise exception 'PROVIDER_NOT_APPROVED'; end if;
  if c.status <> 'active' and not (c.status='disconnected' and exists (
    select 1 from public.delivery_orders where connection_id=c.id and external_order_id=p_event->>'orderId'
  )) then raise exception 'CONNECTION_UNAVAILABLE'; end if;
  select * into existing from public.delivery_events
    where connection_id=c.id and event_key=p_event->>'eventId';
  if found then
    if existing.payload is distinct from p_event then raise exception 'EVENT_ID_CONFLICT'; end if;
    return existing.id;
  end if;
  if c.environment='sandbox' and (select count(*) from public.delivery_events
    where connection_id=c.id and received_at>clock_timestamp()-interval '1 minute') >= 60 then
    raise exception 'SANDBOX_RATE_LIMIT';
  end if;
  insert into public.delivery_events(client_id,branch_id,connection_id,event_key,external_order_id,payload)
    values (c.client_id,c.branch_id,c.id,p_event->>'eventId',p_event->>'orderId',p_event)
    returning id into event_uuid;
  return event_uuid;
end;
$$;

-- Supabase service_role bypasses RLS. Ownership must also be checked by the
-- server and composite foreign keys. Never add browser access to these tables.
do $$
declare relation text;
begin
  foreach relation in array array[
    'delivery_provider_settings','delivery_connections','delivery_product_mappings',
    'delivery_events','delivery_orders','delivery_order_items','delivery_audit'
  ] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('alter table public.%I force row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
    execute format('grant select,insert,update on public.%I to service_role',relation);
  end loop;
end;
$$;
revoke insert,update on public.delivery_provider_settings from service_role;
revoke update on public.delivery_audit from service_role;
grant usage,select on sequence public.delivery_audit_id_seq to service_role;
revoke all on function public.enqueue_delivery_event(uuid,jsonb),
  public.protect_delivery_connection_identity(),public.audit_delivery_connection()
  from public,anon,authenticated;
grant execute on function public.enqueue_delivery_event(uuid,jsonb) to service_role;

create function public.save_delivery_product_mapping(
  p_client_id uuid,p_connection_id uuid,p_external_product_id text,p_product_id uuid,p_actor_user_id uuid
) returns void language plpgsql set search_path = '' as $$
declare c public.delivery_connections%rowtype;
begin
  select * into c from public.delivery_connections where id=p_connection_id and client_id=p_client_id;
  if not found or c.status='disconnected' then raise exception 'CONNECTION_UNAVAILABLE'; end if;
  insert into public.delivery_product_mappings(client_id,branch_id,connection_id,external_product_id,product_id)
    values(c.client_id,c.branch_id,c.id,btrim(p_external_product_id),p_product_id)
    on conflict(connection_id,external_product_id) do update set product_id=excluded.product_id;
  insert into public.delivery_audit(client_id,actor_user_id,action,entity_id)
    values(p_client_id,p_actor_user_id,'product_mapping_saved',p_connection_id);
end;
$$;
create function public.disconnect_delivery_connection(p_client_id uuid,p_connection_id uuid,p_actor_user_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  update public.delivery_connections set status='disconnected'
    where id=p_connection_id and client_id=p_client_id;
  if not found then raise exception 'CONNECTION_UNAVAILABLE'; end if;
  insert into public.delivery_audit(client_id,actor_user_id,action,entity_id)
    values(p_client_id,p_actor_user_id,'merchant_disconnected',p_connection_id);
end;
$$;
revoke all on function public.save_delivery_product_mapping(uuid,uuid,text,uuid,uuid),
  public.disconnect_delivery_connection(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_delivery_product_mapping(uuid,uuid,text,uuid,uuid),
  public.disconnect_delivery_connection(uuid,uuid,uuid) to service_role;

commit;
