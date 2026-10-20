-- Short, human-readable receipt numbers.
-- New format: EZ-{STORE_CODE}-{YYYYMMDD}-{0001..9999}
-- Existing receipt numbers are intentionally left unchanged.
begin;

create or replace function public.derive_client_receipt_code(p_business_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  compact text := upper(regexp_replace(coalesce(p_business_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  words text[];
  initials text;
begin
  -- Known compact spelling supplied by the store owner.
  if compact = 'BULBULLYKENNEL' then return 'BBK'; end if;

  words := regexp_split_to_array(btrim(coalesce(p_business_name, '')), '[^a-zA-Z0-9]+');
  select string_agg(upper(left(word, 1)), '' order by ordinal)
    into initials
    from unnest(words) with ordinality as parts(word, ordinal)
    where word <> '';

  if char_length(coalesce(initials, '')) >= 3 then return left(initials, 3); end if;
  return left(compact || 'XXX', 3);
end;
$$;

alter table public.clients add column if not exists receipt_code text;
update public.clients
  set receipt_code = public.derive_client_receipt_code(business_name)
  where receipt_code is null or btrim(receipt_code) = '';
alter table public.clients alter column receipt_code set not null;
alter table public.clients drop constraint if exists clients_receipt_code_check;
alter table public.clients add constraint clients_receipt_code_check
  check (receipt_code ~ '^[A-Z0-9]{3}$');

create or replace function public.assign_client_receipt_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.receipt_code is null or btrim(new.receipt_code) = '' then
    new.receipt_code := public.derive_client_receipt_code(new.business_name);
  else
    new.receipt_code := upper(btrim(new.receipt_code));
  end if;
  return new;
end;
$$;

drop trigger if exists clients_assign_receipt_code on public.clients;
create trigger clients_assign_receipt_code
  before insert or update of receipt_code on public.clients
  for each row execute function public.assign_client_receipt_code();

create table if not exists public.pos_receipt_counters (
  receipt_code text not null check (receipt_code ~ '^[A-Z0-9]{3}$'),
  business_date date not null,
  last_number integer not null check (last_number between 1 and 9999),
  primary key (receipt_code, business_date)
);

create or replace function public.next_pos_receipt_number(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  store_code text;
  business_day date := (clock_timestamp() at time zone 'Asia/Manila')::date;
  next_number integer;
begin
  select receipt_code into store_code
    from public.clients where id = p_client_id;
  if store_code is null then raise exception 'CLIENT_RECEIPT_CODE_MISSING'; end if;

  insert into public.pos_receipt_counters(receipt_code, business_date, last_number)
    values(store_code, business_day, 1)
  on conflict (receipt_code, business_date) do update
    set last_number = public.pos_receipt_counters.last_number + 1
    where public.pos_receipt_counters.last_number < 9999
  returning last_number into next_number;

  if next_number is null then raise exception 'DAILY_RECEIPT_LIMIT_REACHED'; end if;
  return 'EZ-' || store_code || '-' || to_char(business_day, 'YYYYMMDD') || '-'
    || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.assign_short_pos_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.receipt_number is null
    or new.receipt_number !~ '^EZ-[A-Z0-9]{3}-[0-9]{8}-[0-9]{4}$' then
    new.receipt_number := public.next_pos_receipt_number(new.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_assign_short_receipt on public.pos_sales;
create trigger pos_sales_assign_short_receipt
  before insert on public.pos_sales
  for each row execute function public.assign_short_pos_receipt_number();

create or replace function public.complete_branch_pos_sale(
  p_client_id uuid, p_branch_id uuid, p_cashier_user_id uuid,
  p_items jsonb, p_payment_method text, p_tendered_centavos bigint, p_request_id uuid
)
returns table(sale_id uuid, receipt_number text, total_centavos bigint, change_centavos bigint)
language plpgsql set search_path = '' as $$
declare
  saved public.pos_sales%rowtype;
  product record;
  total_value bigint := 0;
  change_value bigint := 0;
  sale_uuid uuid := gen_random_uuid();
  receipt text;
  canonical_cart jsonb;
  request jsonb;
  cart_count integer;
begin
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if not exists (select 1 from public.client_branches
    where id = p_branch_id and client_id = p_client_id and is_active) then
    raise exception 'BRANCH_UNAVAILABLE';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'INVALID_CART'; end if;
  if jsonb_array_length(p_items) not between 1 and 50 then raise exception 'INVALID_CART'; end if;
  if p_payment_method is null or p_payment_method not in ('cash','gcash','card','bank') then
    raise exception 'INVALID_PAYMENT';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x->'quantity') is distinct from 'number'
      or (x->>'quantity')::numeric <> trunc((x->>'quantity')::numeric)
      or (x->>'quantity')::numeric not between 1 and 10000
      or nullif(x->>'productId', '') is null
  ) then raise exception 'INVALID_QUANTITY'; end if;
  select jsonb_agg(jsonb_build_object('productId', c.id, 'quantity', c.quantity) order by c.id)
    into canonical_cart
    from (
      select (x->>'productId')::uuid id, sum((x->>'quantity')::integer)::integer quantity
      from jsonb_array_elements(p_items) x group by 1
    ) c;
  if exists (select 1 from jsonb_array_elements(canonical_cart) x
    where (x->>'quantity')::integer > 10000) then raise exception 'INVALID_QUANTITY'; end if;
  request := jsonb_build_object('branch', p_branch_id, 'cashier', p_cashier_user_id,
    'items', canonical_cart, 'payment', p_payment_method, 'tendered',
    case when p_payment_method = 'cash' then p_tendered_centavos end);
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text || ':' || p_request_id::text, 0));
  select * into saved from public.pos_sales s
    where s.client_id = p_client_id and s.request_id = p_request_id;
  if found then
    if saved.request_payload is distinct from request then raise exception 'REQUEST_REUSED'; end if;
    return query select saved.id, saved.receipt_number, saved.total_centavos, saved.change_centavos;
    return;
  end if;
  cart_count := jsonb_array_length(canonical_cart);
  perform p.id from public.inventory_products p
    join jsonb_array_elements(canonical_cart) x on (x->>'productId')::uuid = p.id
    where p.client_id = p_client_id and p.branch_id = p_branch_id
    order by p.id for update of p;
  if (select count(*) from public.inventory_products p
      join jsonb_array_elements(canonical_cart) x on (x->>'productId')::uuid = p.id
      where p.client_id = p_client_id and p.branch_id = p_branch_id and p.is_active) <> cart_count then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;
  for product in
    select p.*, (x->>'quantity')::integer quantity from public.inventory_products p
    join jsonb_array_elements(canonical_cart) x on (x->>'productId')::uuid = p.id
    where p.client_id = p_client_id and p.branch_id = p_branch_id order by p.id
  loop
    if product.stock_on_hand < product.quantity then raise exception 'OUT_OF_STOCK'; end if;
    total_value := total_value + product.sale_price_centavos * product.quantity;
  end loop;
  if total_value > 1000000000000 then raise exception 'SALE_TOO_LARGE'; end if;
  if p_payment_method = 'cash' then
    if p_tendered_centavos is null or p_tendered_centavos < total_value then
      raise exception 'INSUFFICIENT_PAYMENT';
    end if;
    change_value := p_tendered_centavos - total_value;
  end if;
  receipt := public.next_pos_receipt_number(p_client_id);
  insert into public.pos_sales(
    id, client_id, branch_id, receipt_number, subtotal_centavos, total_centavos,
    payment_method, tendered_centavos, change_centavos, cashier_user_id, request_id, request_payload
  ) values (
    sale_uuid, p_client_id, p_branch_id, receipt, total_value, total_value,
    p_payment_method, case when p_payment_method = 'cash' then p_tendered_centavos end,
    change_value, p_cashier_user_id, p_request_id, request
  );
  for product in
    select p.*, (x->>'quantity')::integer quantity from public.inventory_products p
    join jsonb_array_elements(canonical_cart) x on (x->>'productId')::uuid = p.id
    where p.client_id = p_client_id and p.branch_id = p_branch_id order by p.id
  loop
    insert into public.pos_sale_items(
      sale_id, product_id, sku, product_name, quantity, unit_price_centavos, line_total_centavos
    ) values (sale_uuid, product.id, product.sku, product.name, product.quantity,
      product.sale_price_centavos, product.quantity * product.sale_price_centavos);
    update public.inventory_products set stock_on_hand = stock_on_hand - product.quantity,
      updated_at = now() where id = product.id;
    insert into public.inventory_stock_movements(
      client_id, product_id, movement_type, quantity_change, balance_after,
      reference_type, reference_id, note, actor_user_id
    ) values (p_client_id, product.id, 'sale', -product.quantity,
      product.stock_on_hand - product.quantity, 'pos_sale', sale_uuid::text, receipt, p_cashier_user_id);
  end loop;
  return query select sale_uuid, receipt, total_value, change_value;
end;
$$;

revoke all on table public.pos_receipt_counters from public, anon, authenticated, service_role;
revoke all on function public.derive_client_receipt_code(text),
  public.assign_client_receipt_code(), public.next_pos_receipt_number(uuid),
  public.assign_short_pos_receipt_number() from public, anon, authenticated;
grant execute on function public.next_pos_receipt_number(uuid) to service_role;
revoke all on function public.complete_branch_pos_sale(uuid,uuid,uuid,jsonb,text,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.complete_branch_pos_sale(uuid,uuid,uuid,jsonb,text,bigint,uuid)
  to service_role;

comment on column public.clients.receipt_code is
  'Three-character uppercase code used in human-readable receipt numbers.';
comment on table public.pos_receipt_counters is
  'Atomic daily counters for short POS receipt numbers; never update from application code.';

commit;

-- To override a store code later, use its exact client ID:
-- update public.clients set receipt_code = 'ABC' where id = '<client-uuid>';
