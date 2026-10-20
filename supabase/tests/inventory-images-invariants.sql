-- Destructive fixtures for the EMPTY, DISPOSABLE CI database only.
begin;

do $$
declare
  client_a uuid := '00000000-0000-4000-8000-000000000001';
  client_b uuid := '00000000-0000-4000-8000-000000000002';
  branch_a uuid;
  branch_b uuid;
  product_a uuid;
  image_one uuid;
  image_two uuid;
  image_three uuid;
  replacement uuid;
  first_key text;
  first_position smallint;
  replacement_position smallint;
begin
  if has_table_privilege('anon', 'public.inventory_product_images', 'SELECT')
    or has_table_privilege('authenticated', 'public.inventory_product_images', 'INSERT')
    or has_table_privilege('service_role', 'public.inventory_product_images', 'INSERT')
    or has_table_privilege('service_role', 'public.inventory_product_images', 'UPDATE')
    or has_table_privilege('service_role', 'public.inventory_product_images', 'DELETE')
    or exists (
      select 1
      from unnest(array[
        'public.reserve_inventory_product_image(uuid,uuid,uuid,uuid,text,bigint,text)',
        'public.finalize_inventory_product_image(uuid,uuid,text,timestamptz)',
        'public.fail_inventory_product_image(uuid,uuid,text)',
        'public.begin_inventory_product_image_delete(uuid,uuid)',
        'public.complete_inventory_product_image_delete(uuid,uuid)'
      ]) as denied(signature)
      where has_function_privilege('anon', denied.signature, 'EXECUTE')
    )
    or has_function_privilege(
      'authenticated',
      'public.reserve_inventory_product_image(uuid,uuid,uuid,uuid,text,bigint,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.finalize_inventory_product_image(uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.fail_inventory_product_image(uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.begin_inventory_product_image_delete(uuid,uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.complete_inventory_product_image_delete(uuid,uuid)',
      'EXECUTE'
    )
    or not has_table_privilege('service_role', 'public.inventory_product_images', 'SELECT')
    or not has_function_privilege(
      'service_role',
      'public.reserve_inventory_product_image(uuid,uuid,uuid,uuid,text,bigint,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.finalize_inventory_product_image(uuid,uuid,text,timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.fail_inventory_product_image(uuid,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.begin_inventory_product_image_delete(uuid,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.complete_inventory_product_image_delete(uuid,uuid)',
      'EXECUTE'
    )
  then
    raise exception 'unexpected product-image privileges';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.inventory_product_images'::regclass
      and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'product-image forced RLS missing';
  end if;
  raise notice 'PASS product-image browser isolation and service-role grants';

  select id into branch_a from public.client_branches
    where client_id = client_a and is_primary;
  select id into branch_b from public.client_branches
    where client_id = client_b and is_primary;
  select id into product_a from public.inventory_products
    where client_id = client_a and branch_id = branch_a and sku = 'COFFEE';

  select image_id, image_object_key, image_position
  into image_one, first_key, first_position
  from public.reserve_inventory_product_image(
    client_a, branch_a, product_a, client_a,
    'image/jpeg', 100, repeat('A', 43) || '='
  );

  if first_position <> 1 or first_key <> (
    'clients/' || client_a::text || '/branches/' || branch_a::text ||
    '/products/' || product_a::text || '/' || image_one::text || '.jpg'
  ) then
    raise exception 'generated image key or first position is incorrect';
  end if;

  begin
    perform public.reserve_inventory_product_image(
      client_a, branch_b, product_a, client_a,
      'image/jpeg', 100, repeat('B', 43) || '='
    );
    raise exception 'cross-branch image reservation succeeded';
  exception when raise_exception then
    if SQLERRM <> 'PRODUCT_UNAVAILABLE' then raise; end if;
  end;

  begin
    perform public.reserve_inventory_product_image(
      client_a, branch_a, product_a, client_a,
      'image/svg+xml', 100, repeat('B', 43) || '='
    );
    raise exception 'SVG image reservation succeeded';
  exception when check_violation then null;
  end;

  begin
    perform public.reserve_inventory_product_image(
      client_a, branch_a, product_a, client_a,
      'image/png', 5242881, repeat('B', 43) || '='
    );
    raise exception 'oversized image reservation succeeded';
  exception when check_violation then null;
  end;
  raise notice 'PASS composite ownership and bounded image metadata';

  select image_id into image_two
  from public.reserve_inventory_product_image(
    client_a, branch_a, product_a, client_a,
    'image/png', 200, repeat('B', 43) || '='
  );
  select image_id into image_three
  from public.reserve_inventory_product_image(
    client_a, branch_a, product_a, client_a,
    'image/webp', 300, repeat('C', 43) || '='
  );

  begin
    perform public.reserve_inventory_product_image(
      client_a, branch_a, product_a, client_a,
      'image/jpeg', 400, repeat('D', 43) || '='
    );
    raise exception 'fourth active image slot succeeded';
  exception when raise_exception then
    if SQLERRM <> 'IMAGE_LIMIT_REACHED' then raise; end if;
  end;

  perform public.fail_inventory_product_image(client_a, image_three, 'TEST_FAILURE');
  perform 1 from public.begin_inventory_product_image_delete(client_a, image_three);
  perform public.complete_inventory_product_image_delete(client_a, image_three);
  select image_id, image_position into replacement, replacement_position
  from public.reserve_inventory_product_image(
    client_a, branch_a, product_a, client_a,
    'image/webp', 301, repeat('D', 43) || '='
  );
  if replacement_position <> 3 then
    raise exception 'failed image slot was not reused';
  end if;
  raise notice 'PASS transactional three-slot limit and failed-slot reuse';

  perform 1 from public.finalize_inventory_product_image(client_a, image_one, '"etag-one"', now());
  perform 1 from public.finalize_inventory_product_image(client_a, image_two, '"etag-two"', now());
  if (select count(*) from public.inventory_product_images
      where client_id = client_a and product_id = product_a and status = 'ready' and is_primary) <> 1
  then
    raise exception 'product does not have exactly one primary image';
  end if;

  begin
    perform 1 from public.finalize_inventory_product_image(
      client_a, image_one, '"different-etag"', now()
    );
    raise exception 'conflicting ready image ETag succeeded';
  exception when raise_exception then
    if SQLERRM <> 'IMAGE_ETAG_CONFLICT' then raise; end if;
  end;

  begin
    perform 1 from public.finalize_inventory_product_image(
      client_a, replacement, '"late-etag"', now() + interval '10 minutes'
    );
    raise exception 'expired image finalization succeeded';
  exception when raise_exception then
    if SQLERRM <> 'IMAGE_UPLOAD_EXPIRED' then raise; end if;
  end;

  begin
    update public.inventory_product_images set byte_size = 101 where id = image_one;
    raise exception 'image identity mutation succeeded';
  exception when raise_exception then
    if SQLERRM <> 'IMAGE_IDENTITY_IMMUTABLE' then raise; end if;
  end;

  begin
    update public.inventory_product_images
      set status = 'deleted', deleted_at = now() where id = image_two;
    raise exception 'illegal ready-to-deleted transition succeeded';
  exception when raise_exception then
    if SQLERRM <> 'INVALID_IMAGE_STATUS_TRANSITION' then raise; end if;
  end;

  begin
    delete from public.inventory_product_images where id = image_two;
    raise exception 'physical image metadata deletion succeeded';
  exception when raise_exception then
    if SQLERRM <> 'IMAGE_METADATA_SOFT_DELETE_REQUIRED' then raise; end if;
  end;

  perform 1 from public.begin_inventory_product_image_delete(client_a, image_one);
  perform public.complete_inventory_product_image_delete(client_a, image_one);
  if not exists (
    select 1 from public.inventory_product_images
    where id = image_two and status = 'ready' and is_primary
  ) then
    raise exception 'primary image was not promoted after deletion';
  end if;
  raise notice 'PASS primary selection, immutable history, and soft deletion';
end;
$$;

rollback;
