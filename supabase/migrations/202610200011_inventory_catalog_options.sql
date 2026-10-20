-- Client-managed inventory categories, canonical inventory units, and optional SKUs.
-- Requires 202610120007_client_branches.sql.
begin;

create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index inventory_categories_client_name_idx
  on public.inventory_categories(client_id, lower(btrim(name)));
create index inventory_categories_client_active_idx
  on public.inventory_categories(client_id, is_active, name, id);

-- Every existing workspace gets a safe default. Existing free-text categories
-- are retained as options, with case-only duplicates collapsed per client.
insert into public.inventory_categories(client_id, name)
select client.id, 'General'
from public.clients as client
on conflict do nothing;

insert into public.inventory_categories(client_id, name)
select product.client_id, min(btrim(product.category))
from public.inventory_products as product
where lower(btrim(product.category)) <> 'general'
group by product.client_id, lower(btrim(product.category))
on conflict do nothing;

create function public.create_default_inventory_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.inventory_categories(client_id, name)
  values (new.id, 'General')
  on conflict do nothing;
  return new;
end;
$$;

create trigger clients_create_default_inventory_category
after insert on public.clients
for each row execute function public.create_default_inventory_category();

drop trigger if exists inventory_categories_set_updated_at
  on public.inventory_categories;
create trigger inventory_categories_set_updated_at
before update on public.inventory_categories
for each row execute function public.set_admin_workspace_updated_at();

alter table public.inventory_categories enable row level security;
alter table public.inventory_categories force row level security;

revoke all on table public.inventory_categories
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.inventory_categories
  to service_role;

revoke all on function public.create_default_inventory_category()
  from public, anon, authenticated, service_role;

-- The original catalog accepted arbitrary unit labels. Canonicalize the known
-- legacy labels before enforcing the dropdown values so ordinary stock updates
-- cannot be blocked by a pre-migration row. Abort instead of silently changing
-- an unknown business unit: operators must explicitly map it before retrying.
do $$
declare
  unmapped_units text;
begin
  select string_agg(quote_literal(found.unit), ', ' order by found.unit)
  into unmapped_units
  from (
    select distinct btrim(unit) as unit
    from public.inventory_products
    where lower(btrim(unit)) not in (
      'piece', 'pieces', 'pc', 'pcs', 'unit', 'units', 'each', 'cup', 'cups',
      'pack', 'packs', 'packet', 'packets',
      'box', 'boxes', 'carton', 'cartons',
      'bundle', 'bundles', 'set', 'sets',
      'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
      'gram', 'grams', 'grm', 'grms', 'g'
    )
  ) as found;

  if unmapped_units is not null then
    raise exception 'UNMAPPED_INVENTORY_UNITS: %. Map these values to piece, pack, box, bundle, ml, or grams before applying migration 011.',
      unmapped_units;
  end if;
end;
$$;

update public.inventory_products
set unit = case
  when lower(btrim(unit)) in ('piece', 'pieces', 'pc', 'pcs', 'unit', 'units', 'each', 'cup', 'cups') then 'piece'
  when lower(btrim(unit)) in ('pack', 'packs', 'packet', 'packets') then 'pack'
  when lower(btrim(unit)) in ('box', 'boxes', 'carton', 'cartons') then 'box'
  when lower(btrim(unit)) in ('bundle', 'bundles', 'set', 'sets') then 'bundle'
  when lower(btrim(unit)) in ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') then 'ml'
  when lower(btrim(unit)) in ('gram', 'grams', 'grm', 'grms', 'g') then 'grams'
  else unit
end
where unit not in ('piece', 'pack', 'box', 'bundle', 'ml', 'grams');

alter table public.inventory_products alter column unit set default 'piece';
alter table public.inventory_products
  add constraint inventory_products_unit_catalog_check
  check (unit in ('piece', 'pack', 'box', 'bundle', 'ml', 'grams'))
  not valid;
alter table public.inventory_products
  validate constraint inventory_products_unit_catalog_check;

-- Preserve the existing RPC signature and ledger behavior. A blank SKU is
-- generated from the product UUID, making it stable, globally unique, and
-- safely below the existing 60-character SKU limit.
create or replace function public.create_branch_inventory_product(
  p_client_id uuid, p_branch_id uuid, p_actor_user_id uuid,
  p_sku text, p_barcode text, p_name text, p_category text, p_unit text,
  p_sale_price_centavos bigint, p_cost_centavos bigint,
  p_opening_stock integer, p_reorder_level integer
)
returns uuid language plpgsql set search_path = '' as $$
declare
  new_product uuid := gen_random_uuid();
  resolved_sku text;
begin
  if not exists (select 1 from public.client_branches
    where id = p_branch_id and client_id = p_client_id and is_active) then
    raise exception 'BRANCH_UNAVAILABLE';
  end if;

  resolved_sku := nullif(btrim(p_sku), '');
  if resolved_sku is null then
    resolved_sku := 'AUTO-' || upper(replace(new_product::text, '-', ''));
  end if;

  insert into public.inventory_products(
    id, client_id, branch_id, sku, barcode, name, category, unit,
    sale_price_centavos, cost_centavos, stock_on_hand, reorder_level
  ) values (
    new_product, p_client_id, p_branch_id, resolved_sku,
    nullif(btrim(p_barcode), ''), btrim(p_name), btrim(p_category),
    btrim(p_unit), p_sale_price_centavos, p_cost_centavos,
    p_opening_stock, p_reorder_level
  );

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

revoke all on function
  public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer)
  to service_role;

comment on table public.inventory_categories is
  'Client-scoped inventory category options managed by the trusted application backend.';
comment on constraint inventory_products_unit_catalog_check on public.inventory_products is
  'Canonical item units exposed by the inventory product editor.';

commit;
