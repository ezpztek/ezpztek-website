-- Requires 202610070006. Forward migration: stage and back up before production.
-- Keeps current client_id identity and moves existing stock to a Main branch.
begin;

create table public.client_branches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, id)
);
create unique index client_branches_primary
  on public.client_branches(client_id) where is_primary;
insert into public.client_branches(client_id, name, is_primary)
  select id, 'Main branch', true from public.clients;

create function public.create_primary_client_branch()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.client_branches(client_id, name, is_primary)
    values (new.id, 'Main branch', true);
  return new;
end;
$$;
create trigger clients_create_primary_branch after insert on public.clients
  for each row execute function public.create_primary_client_branch();

alter table public.inventory_products add column branch_id uuid;
update public.inventory_products p set branch_id = b.id
  from public.client_branches b where b.client_id = p.client_id and b.is_primary;
alter table public.inventory_products alter column branch_id set not null;
alter table public.inventory_products add constraint products_branch_owner
  foreign key (client_id, branch_id) references public.client_branches(client_id, id);
alter table public.inventory_products add constraint products_branch_identity
  unique (client_id, branch_id, id);
drop index public.inventory_products_client_sku_idx;
drop index public.inventory_products_client_barcode_idx;
create unique index inventory_products_client_sku_idx
  on public.inventory_products(client_id, branch_id, lower(sku));
create unique index inventory_products_client_barcode_idx
  on public.inventory_products(client_id, branch_id, lower(barcode)) where barcode is not null;
create index inventory_products_branch_pos_idx
  on public.inventory_products(client_id, branch_id, is_active, name, id);

alter table public.pos_sales add column branch_id uuid;
alter table public.pos_sales add column source text not null default 'pos'
  check (source in ('pos', 'foodpanda'));
alter table public.pos_sales add column request_id uuid;
alter table public.pos_sales add column request_payload jsonb;
update public.pos_sales s set branch_id = b.id from public.client_branches b
  where b.client_id = s.client_id and b.is_primary;
alter table public.pos_sales alter column branch_id set not null;
alter table public.pos_sales add constraint sales_branch_owner
  foreign key (client_id, branch_id) references public.client_branches(client_id, id);
alter table public.pos_sales add constraint sales_branch_identity unique (client_id, branch_id, id);
create unique index pos_sales_request_id on public.pos_sales(client_id, request_id)
  where request_id is not null;
create index pos_sales_branch_created on public.pos_sales(client_id, branch_id, created_at desc);
alter table public.pos_sales drop constraint pos_sales_payment_method_check;
alter table public.pos_sales add constraint pos_sales_payment_method_check
  check (payment_method in ('cash', 'gcash', 'card', 'bank', 'delivery'));

-- Backward-compatible defaults during deployment; all revised application paths
-- pass the branch explicitly. Cross-branch line items are rejected below.
create function public.assign_default_client_branch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.branch_id is null then
    select id into new.branch_id from public.client_branches
      where client_id = new.client_id and is_primary and is_active;
  end if;
  return new;
end;
$$;
create trigger products_default_branch before insert on public.inventory_products
  for each row execute function public.assign_default_client_branch();
create trigger sales_default_branch before insert on public.pos_sales
  for each row execute function public.assign_default_client_branch();
create function public.protect_record_branch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.client_id, new.branch_id) is distinct from (old.client_id, old.branch_id) then
    raise exception 'RECORD_OWNERSHIP_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger products_immutable_owner before update on public.inventory_products
  for each row execute function public.protect_record_branch();
create trigger sales_immutable_owner before update on public.pos_sales
  for each row execute function public.protect_record_branch();

alter table public.inventory_stock_movements add column branch_id uuid;
update public.inventory_stock_movements m set branch_id = p.branch_id
  from public.inventory_products p where p.id = m.product_id;
alter table public.inventory_stock_movements alter column branch_id set not null;
alter table public.inventory_stock_movements add constraint movement_product_owner
  foreign key (client_id, branch_id, product_id)
  references public.inventory_products(client_id, branch_id, id);
create function public.assign_stock_movement_branch()
returns trigger language plpgsql set search_path = '' as $$
begin
  select branch_id into new.branch_id from public.inventory_products
    where id = new.product_id and client_id = new.client_id;
  return new;
end;
$$;
create trigger movements_assign_branch before insert on public.inventory_stock_movements
  for each row execute function public.assign_stock_movement_branch();
create function public.reject_stock_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'STOCK_LEDGER_APPEND_ONLY';
end;
$$;
create trigger movements_append_only before update or delete on public.inventory_stock_movements
  for each row execute function public.reject_stock_ledger_mutation();

alter table public.pos_sale_items add column client_id uuid;
alter table public.pos_sale_items add column branch_id uuid;
update public.pos_sale_items i set client_id = s.client_id, branch_id = s.branch_id
  from public.pos_sales s where s.id = i.sale_id;
alter table public.pos_sale_items alter column client_id set not null;
alter table public.pos_sale_items alter column branch_id set not null;
alter table public.pos_sale_items add constraint sale_items_sale_owner
  foreign key (client_id, branch_id, sale_id) references public.pos_sales(client_id, branch_id, id);
alter table public.pos_sale_items add constraint sale_items_product_owner
  foreign key (client_id, branch_id, product_id) references public.inventory_products(client_id, branch_id, id);
create function public.assign_sale_item_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  select client_id, branch_id into new.client_id, new.branch_id
    from public.pos_sales where id = new.sale_id;
  return new;
end;
$$;
create trigger sale_items_assign_owner before insert on public.pos_sale_items
  for each row execute function public.assign_sale_item_owner();

create function public.create_branch_inventory_product(
  p_client_id uuid, p_branch_id uuid, p_actor_user_id uuid,
  p_sku text, p_barcode text, p_name text, p_category text, p_unit text,
  p_sale_price_centavos bigint, p_cost_centavos bigint,
  p_opening_stock integer, p_reorder_level integer
)
returns uuid language plpgsql set search_path = '' as $$
declare new_product uuid;
begin
  if not exists (select 1 from public.client_branches
    where id = p_branch_id and client_id = p_client_id and is_active) then
    raise exception 'BRANCH_UNAVAILABLE';
  end if;
  insert into public.inventory_products(
    client_id, branch_id, sku, barcode, name, category, unit,
    sale_price_centavos, cost_centavos, stock_on_hand, reorder_level
  ) values (
    p_client_id, p_branch_id, btrim(p_sku), nullif(btrim(p_barcode), ''),
    btrim(p_name), btrim(p_category), btrim(p_unit), p_sale_price_centavos,
    p_cost_centavos, p_opening_stock, p_reorder_level
  ) returning id into new_product;
  if p_opening_stock > 0 then
    insert into public.inventory_stock_movements(
      client_id, product_id, movement_type, quantity_change, balance_after,
      reference_type, reference_id, note, actor_user_id
    ) values (
      p_client_id, new_product, 'opening', p_opening_stock, p_opening_stock,
      'product', new_product::text, 'Opening stock', p_actor_user_id
    );
  end if;
  return new_product;
end;
$$;

create function public.complete_branch_pos_sale(
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
  receipt := 'EZ-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-'
    || upper(replace(sale_uuid::text, '-', ''));
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

create function public.get_branch_pos_summary(p_client_id uuid, p_branch_id uuid)
returns table(sale_count bigint, total_centavos numeric)
language sql stable set search_path = '' as $$
  select count(*), coalesce(sum(s.total_centavos), 0) from public.pos_sales s
  where s.client_id = p_client_id and s.branch_id = p_branch_id and s.status = 'completed'
    and s.created_at >= (date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
$$;

alter table public.client_branches enable row level security;
alter table public.client_branches force row level security;
revoke all on public.client_branches from public, anon, authenticated, service_role;
grant select, insert, update on public.client_branches to service_role;
revoke all on function public.create_primary_client_branch(), public.assign_default_client_branch(),
  public.protect_record_branch(), public.assign_stock_movement_branch(),
  public.reject_stock_ledger_mutation(), public.assign_sale_item_owner()
  from public, anon, authenticated;
revoke all on function
  public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer),
  public.complete_branch_pos_sale(uuid,uuid,uuid,jsonb,text,bigint,uuid),
  public.get_branch_pos_summary(uuid,uuid) from public, anon, authenticated;
grant execute on function
  public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer),
  public.complete_branch_pos_sale(uuid,uuid,uuid,jsonb,text,bigint,uuid),
  public.get_branch_pos_summary(uuid,uuid) to service_role;

create function public.create_client_branch(p_client_id uuid, p_name text)
returns uuid language plpgsql set search_path = '' as $$
declare result uuid;
begin
  perform id from public.clients where id=p_client_id for update;
  if not found then raise exception 'CLIENT_UNAVAILABLE'; end if;
  if (select count(*) from public.client_branches where client_id=p_client_id)>=25 then
    raise exception 'BRANCH_LIMIT_REACHED';
  end if;
  insert into public.client_branches(client_id,name) values(p_client_id,btrim(p_name)) returning id into result;
  return result;
end;
$$;
revoke all on function public.create_client_branch(uuid,text) from public,anon,authenticated;
grant execute on function public.create_client_branch(uuid,text) to service_role;

commit;
