-- Inventory, POS, and item stock control for approved client workspaces.
-- Run after 202610060004_create_client_portal.sql.

create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  sku text not null check (char_length(btrim(sku)) between 1 and 60),
  barcode text check (barcode is null or char_length(btrim(barcode)) between 1 and 80),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  category text not null default 'General'
    check (char_length(btrim(category)) between 2 and 80),
  unit text not null default 'pc'
    check (char_length(btrim(unit)) between 1 and 20),
  sale_price_centavos bigint not null default 0 check (sale_price_centavos >= 0),
  cost_centavos bigint not null default 0 check (cost_centavos >= 0),
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_products_client_sku_idx
  on public.inventory_products (client_id, lower(sku));
create unique index if not exists inventory_products_client_barcode_idx
  on public.inventory_products (client_id, lower(barcode))
  where barcode is not null;
create index if not exists inventory_products_pos_idx
  on public.inventory_products (client_id, is_active, stock_on_hand, name);

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  receipt_number text not null unique,
  subtotal_centavos bigint not null check (subtotal_centavos >= 0),
  discount_centavos bigint not null default 0 check (discount_centavos >= 0),
  total_centavos bigint not null check (total_centavos >= 0),
  payment_method text not null
    check (payment_method in ('cash', 'gcash', 'card', 'bank')),
  tendered_centavos bigint check (tendered_centavos is null or tendered_centavos >= 0),
  change_centavos bigint not null default 0 check (change_centavos >= 0),
  status text not null default 'completed'
    check (status in ('completed', 'voided')),
  cashier_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_sales_client_created_idx
  on public.pos_sales (client_id, created_at desc);

create table if not exists public.pos_sale_items (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.pos_sales (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id),
  sku text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_centavos bigint not null check (unit_price_centavos >= 0),
  line_total_centavos bigint not null check (line_total_centavos >= 0)
);

create index if not exists pos_sale_items_sale_idx
  on public.pos_sale_items (sale_id);

create table if not exists public.inventory_stock_movements (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  product_id uuid not null references public.inventory_products (id),
  movement_type text not null
    check (movement_type in ('opening', 'sale', 'receipt', 'adjustment_in', 'adjustment_out', 'damage', 'return')),
  quantity_change integer not null check (quantity_change <> 0),
  balance_after integer not null check (balance_after >= 0),
  reference_type text,
  reference_id text,
  note text not null default '' check (char_length(note) <= 500),
  actor_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_client_created_idx
  on public.inventory_stock_movements (client_id, created_at desc);
create index if not exists inventory_movements_product_created_idx
  on public.inventory_stock_movements (product_id, created_at desc);

create or replace function public.create_inventory_product(
  p_client_id uuid,
  p_actor_user_id uuid,
  p_sku text,
  p_barcode text,
  p_name text,
  p_category text,
  p_unit text,
  p_sale_price_centavos bigint,
  p_cost_centavos bigint,
  p_opening_stock integer,
  p_reorder_level integer
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_product_id uuid;
begin
  if p_opening_stock < 0 or p_reorder_level < 0 then
    raise exception 'Stock values cannot be negative';
  end if;

  insert into public.inventory_products (
    client_id, sku, barcode, name, category, unit,
    sale_price_centavos, cost_centavos, stock_on_hand, reorder_level
  ) values (
    p_client_id,
    btrim(p_sku),
    nullif(btrim(p_barcode), ''),
    btrim(p_name),
    btrim(p_category),
    btrim(p_unit),
    p_sale_price_centavos,
    p_cost_centavos,
    p_opening_stock,
    p_reorder_level
  )
  returning id into new_product_id;

  if p_opening_stock > 0 then
    insert into public.inventory_stock_movements (
      client_id, product_id, movement_type, quantity_change,
      balance_after, reference_type, reference_id, note, actor_user_id
    ) values (
      p_client_id, new_product_id, 'opening', p_opening_stock,
      p_opening_stock, 'product', new_product_id::text,
      'Opening stock', p_actor_user_id
    );
  end if;

  return new_product_id;
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_client_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_note text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  product_record public.inventory_products%rowtype;
  quantity_change integer;
  new_balance integer;
begin
  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if p_movement_type not in ('receipt', 'adjustment_in', 'adjustment_out', 'damage', 'return') then
    raise exception 'Unsupported stock movement type';
  end if;

  select * into product_record
  from public.inventory_products
  where id = p_product_id and client_id = p_client_id
  for update;

  if product_record.id is null then
    raise exception 'Product not found';
  end if;

  quantity_change := case
    when p_movement_type in ('receipt', 'adjustment_in', 'return') then p_quantity
    else -p_quantity
  end;
  new_balance := product_record.stock_on_hand + quantity_change;

  if new_balance < 0 then
    raise exception 'INSUFFICIENT_STOCK:%', product_record.name;
  end if;

  update public.inventory_products
  set stock_on_hand = new_balance, updated_at = now()
  where id = product_record.id;

  insert into public.inventory_stock_movements (
    client_id, product_id, movement_type, quantity_change,
    balance_after, reference_type, reference_id, note, actor_user_id
  ) values (
    p_client_id, product_record.id, p_movement_type, quantity_change,
    new_balance, 'manual', null, left(coalesce(p_note, ''), 500), p_actor_user_id
  );

  return new_balance;
end;
$$;

create or replace function public.complete_pos_sale(
  p_client_id uuid,
  p_cashier_user_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_tendered_centavos bigint
)
returns table (
  sale_id uuid,
  receipt_number text,
  total_centavos bigint,
  change_centavos bigint
)
language plpgsql
set search_path = ''
as $$
declare
  sale_uuid uuid := gen_random_uuid();
  receipt_text text;
  subtotal_value bigint := 0;
  change_value bigint := 0;
  requested_count integer;
  product_record record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Cart contains too many lines';
  end if;
  if p_payment_method not in ('cash', 'gcash', 'card', 'bank') then
    raise exception 'Unsupported payment method';
  end if;

  with cart as (
    select
      (item->>'productId')::uuid as product_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as item
    group by (item->>'productId')::uuid
  )
  select count(*) into requested_count from cart;

  if exists (
    with cart as (
      select
        (item->>'productId')::uuid as product_id,
        sum((item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as item
      group by (item->>'productId')::uuid
    )
    select 1 from cart where quantity <= 0 or quantity > 10000
  ) then
    raise exception 'Invalid sale quantity';
  end if;

  perform product.id
  from public.inventory_products as product
  join (
    select (item->>'productId')::uuid as product_id
    from jsonb_array_elements(p_items) as item
    group by (item->>'productId')::uuid
  ) as cart on cart.product_id = product.id
  where product.client_id = p_client_id
  order by product.id
  for update of product;

  if (
    select count(*)
    from public.inventory_products as product
    join (
      select (item->>'productId')::uuid as product_id
      from jsonb_array_elements(p_items) as item
      group by (item->>'productId')::uuid
    ) as cart on cart.product_id = product.id
    where product.client_id = p_client_id and product.is_active = true
  ) <> requested_count then
    raise exception 'One or more products are unavailable';
  end if;

  for product_record in
    with cart as (
      select
        (item->>'productId')::uuid as product_id,
        sum((item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as item
      group by (item->>'productId')::uuid
    )
    select product.*, cart.quantity
    from public.inventory_products as product
    join cart on cart.product_id = product.id
    where product.client_id = p_client_id and product.is_active = true
    order by product.id
  loop
    if product_record.stock_on_hand < product_record.quantity then
      raise exception 'OUT_OF_STOCK:%', product_record.name;
    end if;
    subtotal_value := subtotal_value +
      (product_record.sale_price_centavos * product_record.quantity);
  end loop;

  if p_payment_method = 'cash' then
    if p_tendered_centavos is null or p_tendered_centavos < subtotal_value then
      raise exception 'INSUFFICIENT_PAYMENT';
    end if;
    change_value := p_tendered_centavos - subtotal_value;
  else
    change_value := 0;
  end if;

  receipt_text := 'EZ-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
    upper(substr(replace(sale_uuid::text, '-', ''), 1, 8));

  insert into public.pos_sales (
    id, client_id, receipt_number, subtotal_centavos, total_centavos,
    payment_method, tendered_centavos, change_centavos, cashier_user_id
  ) values (
    sale_uuid, p_client_id, receipt_text, subtotal_value, subtotal_value,
    p_payment_method,
    case when p_payment_method = 'cash' then p_tendered_centavos else null end,
    change_value, p_cashier_user_id
  );

  for product_record in
    with cart as (
      select
        (item->>'productId')::uuid as product_id,
        sum((item->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as item
      group by (item->>'productId')::uuid
    )
    select product.*, cart.quantity
    from public.inventory_products as product
    join cart on cart.product_id = product.id
    where product.client_id = p_client_id and product.is_active = true
    order by product.id
  loop
    insert into public.pos_sale_items (
      sale_id, product_id, sku, product_name, quantity,
      unit_price_centavos, line_total_centavos
    ) values (
      sale_uuid, product_record.id, product_record.sku, product_record.name,
      product_record.quantity, product_record.sale_price_centavos,
      product_record.sale_price_centavos * product_record.quantity
    );

    update public.inventory_products
    set stock_on_hand = stock_on_hand - product_record.quantity,
        updated_at = now()
    where id = product_record.id;

    insert into public.inventory_stock_movements (
      client_id, product_id, movement_type, quantity_change,
      balance_after, reference_type, reference_id, note, actor_user_id
    ) values (
      p_client_id, product_record.id, 'sale', -product_record.quantity,
      product_record.stock_on_hand - product_record.quantity,
      'pos_sale', sale_uuid::text, receipt_text, p_cashier_user_id
    );
  end loop;

  return query select sale_uuid, receipt_text, subtotal_value, change_value;
end;
$$;

drop trigger if exists inventory_products_set_updated_at on public.inventory_products;
create trigger inventory_products_set_updated_at
before update on public.inventory_products
for each row execute function public.set_admin_workspace_updated_at();

alter table public.inventory_products enable row level security;
alter table public.inventory_products force row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sales force row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_sale_items force row level security;
alter table public.inventory_stock_movements enable row level security;
alter table public.inventory_stock_movements force row level security;

revoke all on table public.inventory_products from public, anon, authenticated, service_role;
revoke all on table public.pos_sales from public, anon, authenticated, service_role;
revoke all on table public.pos_sale_items from public, anon, authenticated, service_role;
revoke all on table public.inventory_stock_movements from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.inventory_products to service_role;
grant select, insert, update, delete on table public.pos_sales to service_role;
grant select, insert, update, delete on table public.pos_sale_items to service_role;
grant select, insert, update, delete on table public.inventory_stock_movements to service_role;
grant usage, select on sequence public.pos_sale_items_id_seq to service_role;
grant usage, select on sequence public.inventory_stock_movements_id_seq to service_role;

revoke all on function public.create_inventory_product(uuid, uuid, text, text, text, text, text, bigint, bigint, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_inventory_product(uuid, uuid, text, text, text, text, text, bigint, bigint, integer, integer)
  to service_role;

revoke all on function public.adjust_inventory_stock(uuid, uuid, uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.adjust_inventory_stock(uuid, uuid, uuid, text, integer, text)
  to service_role;

revoke all on function public.complete_pos_sale(uuid, uuid, jsonb, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_pos_sale(uuid, uuid, jsonb, text, bigint)
  to service_role;

comment on table public.inventory_products is 'Client-scoped product catalog and current stock balance.';
comment on table public.inventory_stock_movements is 'Immutable inventory ledger for receipts, adjustments, and POS deductions.';
comment on table public.pos_sales is 'Completed client POS transactions.';
