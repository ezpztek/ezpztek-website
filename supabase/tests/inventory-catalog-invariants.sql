-- Destructive fixtures for the EMPTY, DISPOSABLE CI database only.
begin;

do $$
declare
  client_a uuid := '00000000-0000-4000-8000-000000000001';
  client_c uuid := '00000000-0000-4000-8000-000000000003';
  branch_a uuid;
  product_one uuid;
  product_two uuid;
  generated_sku text;
begin
  if exists (
    select 1
    from unnest(array['anon', 'authenticated']) as browser_role(name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as operation(name)
    where has_table_privilege(
      browser_role.name, 'public.inventory_categories', operation.name
    )
  )
    or not has_table_privilege('service_role', 'public.inventory_categories', 'SELECT')
    or not has_table_privilege('service_role', 'public.inventory_categories', 'INSERT')
    or not has_table_privilege('service_role', 'public.inventory_categories', 'UPDATE')
    or not has_table_privilege('service_role', 'public.inventory_categories', 'DELETE')
    or has_function_privilege(
      'anon', 'public.create_default_inventory_category()', 'EXECUTE'
    )
    or has_function_privilege(
      'authenticated', 'public.create_default_inventory_category()', 'EXECUTE'
    )
    or has_function_privilege(
      'service_role', 'public.create_default_inventory_category()', 'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.create_branch_inventory_product(uuid,uuid,uuid,text,text,text,text,text,bigint,bigint,integer,integer)',
      'EXECUTE'
    )
  then
    raise exception 'unexpected inventory catalog privileges';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.inventory_categories'::regclass
      and relrowsecurity
      and relforcerowsecurity
  ) then
    raise exception 'inventory category forced RLS missing';
  end if;
  raise notice 'PASS category browser isolation and service-role grants';

  if not exists (
    select 1 from public.inventory_categories
    where client_id = client_a and name = 'General'
  ) or not exists (
    select 1 from public.inventory_categories
    where client_id = client_a and name = 'Drinks'
  ) then
    raise exception 'existing client categories were not seeded';
  end if;

  begin
    insert into public.inventory_categories(client_id, name)
    values (client_a, ' general ');
    raise exception 'case-insensitive duplicate category succeeded';
  exception when unique_violation then null;
  end;

  insert into public.clients(id, business_name, contact_name, contact_email)
  values (client_c, 'Restaurant C', 'Owner C', 'c@example.test');
  if not exists (
    select 1 from public.inventory_categories
    where client_id = client_c and name = 'General'
  ) then
    raise exception 'new client did not receive General category';
  end if;
  raise notice 'PASS category backfill, uniqueness, and new-client default';

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.inventory_products'::regclass
      and conname = 'inventory_products_unit_catalog_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'validated canonical unit constraint missing';
  end if;

  if (select pg_get_expr(adbin, adrelid)
      from pg_attrdef
      where adrelid = 'public.inventory_products'::regclass
        and adnum = (select attnum from pg_attribute
          where attrelid = 'public.inventory_products'::regclass and attname = 'unit'))
      <> '''piece''::text'
    or exists (select 1 from public.inventory_products where unit not in
      ('piece', 'pack', 'box', 'bundle', 'ml', 'grams'))
    or exists (select 1 from public.inventory_products
      where name in ('Coffee', 'Private coffee') and unit <> 'piece')
  then
    raise exception 'inventory unit default or legacy normalization is incorrect';
  end if;

  begin
    insert into public.inventory_products(
      client_id, branch_id, sku, name, category, unit
    ) values (
      client_a,
      (select id from public.client_branches where client_id = client_a and is_primary),
      'INVALID-UNIT-TEST', 'Invalid unit test', 'General', 'bottle'
    );
    raise exception 'noncanonical inventory unit succeeded';
  exception when check_violation then null;
  end;
  raise notice 'PASS canonical unit enforcement';

  select id into branch_a
  from public.client_branches
  where client_id = client_a and is_primary;

  product_one := public.create_branch_inventory_product(
    client_a, branch_a, client_a, null, null,
    'Auto SKU item', 'General', 'piece', 10000, 5000, 3, 1
  );
  product_two := public.create_branch_inventory_product(
    client_a, branch_a, client_a, '   ', null,
    'Second auto SKU item', 'General', 'pack', 20000, 10000, 0, 1
  );

  select sku into generated_sku
  from public.inventory_products
  where id = product_one;

  if generated_sku <> ('AUTO-' || upper(replace(product_one::text, '-', '')))
    or (select sku from public.inventory_products where id = product_two)
      <> ('AUTO-' || upper(replace(product_two::text, '-', '')))
    or product_one = product_two
  then
    raise exception 'optional SKU generation is not stable and unique';
  end if;

  if not exists (
    select 1 from public.inventory_stock_movements
    where product_id = product_one
      and movement_type = 'opening'
      and quantity_change = 3
      and balance_after = 3
  ) or exists (
    select 1 from public.inventory_stock_movements
    where product_id = product_two and movement_type = 'opening'
  ) then
    raise exception 'product creation changed opening-stock ledger behavior';
  end if;
  raise notice 'PASS optional stable SKU and opening-stock ledger behavior';
end;
$$;

rollback;
