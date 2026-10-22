-- Client branding and a single-query workspace summary.
-- Run after migration 012.
begin;

alter table public.clients
  add column if not exists logo_object_key text,
  add column if not exists logo_content_type text,
  add column if not exists logo_byte_size bigint,
  add column if not exists logo_checksum_sha256 text,
  add column if not exists logo_etag text,
  add column if not exists logo_updated_at timestamptz;

alter table public.clients drop constraint if exists clients_logo_metadata_check;
alter table public.clients add constraint clients_logo_metadata_check check (
  (logo_object_key is null and logo_content_type is null and logo_byte_size is null
    and logo_checksum_sha256 is null and logo_etag is null and logo_updated_at is null)
  or
  (logo_object_key is not null
    and logo_object_key ~ '^clients/[0-9a-f-]{36}/branding/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and logo_content_type is not null
    and logo_content_type in ('image/jpeg', 'image/png', 'image/webp')
    and logo_byte_size is not null
    and logo_byte_size between 1 and 5242880
    and logo_checksum_sha256 is not null
    and logo_checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
    and logo_etag is not null
    and char_length(logo_etag) between 1 and 200
    and logo_updated_at is not null)
);

create or replace function public.get_client_workspace_summary(p_client_id uuid)
returns table(
  active_product_count bigint,
  low_stock_count bigint,
  out_of_stock_count bigint,
  inventory_retail_value numeric,
  today_sales_count bigint,
  today_sales_total numeric,
  last_sale_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with inventory as (
    select
      count(*) filter (where p.is_active) as active_product_count,
      count(*) filter (where p.is_active and p.stock_on_hand > 0
        and p.stock_on_hand <= p.reorder_level) as low_stock_count,
      count(*) filter (where p.is_active and p.stock_on_hand = 0) as out_of_stock_count,
      coalesce(sum(p.sale_price_centavos * p.stock_on_hand)
        filter (where p.is_active), 0) as inventory_retail_value
    from public.inventory_products p
    where p.client_id = p_client_id
  ), sales as (
    select
      count(*) filter (where s.status = 'completed' and s.created_at >=
        (date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')) as today_sales_count,
      coalesce(sum(s.total_centavos) filter (where s.status = 'completed' and s.created_at >=
        (date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')), 0) as today_sales_total,
      max(s.created_at) filter (where s.status = 'completed') as last_sale_at
    from public.pos_sales s
    where s.client_id = p_client_id
  )
  select i.active_product_count, i.low_stock_count, i.out_of_stock_count,
    i.inventory_retail_value, s.today_sales_count, s.today_sales_total, s.last_sale_at
  from inventory i cross join sales s;
$$;

revoke all on function public.get_client_workspace_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.get_client_workspace_summary(uuid) to service_role;

comment on function public.get_client_workspace_summary(uuid) is
  'Client-wide inventory and current-day POS metrics for the portal Summary page.';

create or replace function public.get_branch_inventory_summary(
  p_client_id uuid,
  p_branch_id uuid
)
returns table(
  product_count bigint,
  active_product_count bigint,
  low_stock_count bigint,
  inventory_cost_value numeric,
  inventory_retail_value numeric
)
language sql
stable
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where p.is_active),
    count(*) filter (where p.is_active and p.stock_on_hand <= p.reorder_level),
    coalesce(sum(p.cost_centavos * p.stock_on_hand), 0),
    coalesce(sum(p.sale_price_centavos * p.stock_on_hand), 0)
  from public.inventory_products p
  where p.client_id = p_client_id and p.branch_id = p_branch_id;
$$;

revoke all on function public.get_branch_inventory_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_branch_inventory_summary(uuid, uuid) to service_role;

comment on function public.get_branch_inventory_summary(uuid, uuid) is
  'Branch inventory totals without transferring the full catalog to the application.';

commit;
