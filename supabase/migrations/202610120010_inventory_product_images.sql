-- Requires 202610120007. Stores private S3 object metadata while PostgreSQL
-- remains the authority for tenant, branch, product, and lifecycle ownership.
begin;

create table public.inventory_product_images (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  checksum_sha256 text not null
    check (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  object_key text generated always as (
    'clients/' || client_id::text ||
    '/branches/' || branch_id::text ||
    '/products/' || product_id::text ||
    '/' || id::text ||
    case content_type
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      when 'image/webp' then '.webp'
      else '.invalid'
    end
  ) stored,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed', 'deleting', 'deleted')),
  position smallint not null check (position between 1 and 3),
  is_primary boolean not null default false,
  etag text check (etag is null or char_length(etag) between 1 and 200),
  failure_code text check (
    failure_code is null or
    (char_length(failure_code) between 1 and 80 and failure_code ~ '^[A-Z0-9_]+$')
  ),
  upload_expires_at timestamptz not null,
  uploaded_at timestamptz,
  verified_at timestamptz,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_product_images_object_key_unique unique (object_key),
  constraint inventory_product_images_product_owner
    foreign key (client_id, branch_id, product_id)
    references public.inventory_products(client_id, branch_id, id),
  constraint inventory_product_images_upload_window
    check (upload_expires_at > created_at),
  constraint inventory_product_images_primary_ready
    check (not is_primary or status = 'ready'),
  constraint inventory_product_images_pending_metadata
    check (
      status <> 'pending' or
      (
        etag is null and failure_code is null and uploaded_at is null and
        verified_at is null and deleted_at is null and not is_primary
      )
    ),
  constraint inventory_product_images_ready_metadata
    check (
      status <> 'ready' or
      (
        uploaded_at is not null and verified_at is not null and etag is not null and
        failure_code is null and deleted_at is null
      )
    ),
  constraint inventory_product_images_failed_metadata
    check (
      status <> 'failed' or
      (
        failure_code is not null and etag is null and uploaded_at is null and
        verified_at is null and deleted_at is null and not is_primary
      )
    ),
  constraint inventory_product_images_deleted_metadata
    check (
      (status = 'deleted' and deleted_at is not null) or
      (status <> 'deleted' and deleted_at is null)
    )
);

create unique index inventory_product_images_active_position_idx
  on public.inventory_product_images(client_id, branch_id, product_id, position)
  where status in ('pending', 'ready', 'deleting');

create unique index inventory_product_images_primary_idx
  on public.inventory_product_images(client_id, branch_id, product_id)
  where is_primary and status = 'ready';

create index inventory_product_images_ready_idx
  on public.inventory_product_images(client_id, branch_id, product_id, position)
  where status = 'ready';

create index inventory_product_images_pending_expiry_idx
  on public.inventory_product_images(upload_expires_at)
  where status = 'pending';

create function public.protect_inventory_product_image()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMAGE_METADATA_SOFT_DELETE_REQUIRED';
  end if;

  if (
    new.id,
    new.client_id,
    new.branch_id,
    new.product_id,
    new.content_type,
    new.byte_size,
    new.checksum_sha256,
    new.position,
    new.upload_expires_at,
    new.created_at
  ) is distinct from (
    old.id,
    old.client_id,
    old.branch_id,
    old.product_id,
    old.content_type,
    old.byte_size,
    old.checksum_sha256,
    old.position,
    old.upload_expires_at,
    old.created_at
  ) then
    raise exception 'IMAGE_IDENTITY_IMMUTABLE';
  end if;

  if new.created_by is distinct from old.created_by and not (
    old.created_by is not null and new.created_by is null
  ) then
    raise exception 'IMAGE_CREATOR_IMMUTABLE';
  end if;

  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('ready', 'failed', 'deleting')) or
    (old.status = 'ready' and new.status = 'deleting') or
    (old.status = 'failed' and new.status = 'deleting') or
    (old.status = 'deleting' and new.status = 'deleted')
  ) then
    raise exception 'INVALID_IMAGE_STATUS_TRANSITION';
  end if;

  if new.status = old.status then
    if (
      new.etag,
      new.failure_code,
      new.uploaded_at,
      new.verified_at,
      new.deleted_at
    ) is distinct from (
      old.etag,
      old.failure_code,
      old.uploaded_at,
      old.verified_at,
      old.deleted_at
    ) then
      raise exception 'IMAGE_METADATA_IMMUTABLE';
    end if;

    if new.is_primary is distinct from old.is_primary and not (
      old.status = 'ready' and not old.is_primary and new.is_primary
    ) then
      raise exception 'IMAGE_PRIMARY_CHANGE_INVALID';
    end if;
  elsif old.status = 'pending' and new.status = 'ready' then
    if (new.failure_code, new.deleted_at) is distinct from
       (old.failure_code, old.deleted_at) then
      raise exception 'IMAGE_METADATA_TRANSITION_INVALID';
    end if;
  elsif old.status = 'pending' and new.status = 'failed' then
    if (new.etag, new.uploaded_at, new.verified_at, new.deleted_at) is distinct from
       (old.etag, old.uploaded_at, old.verified_at, old.deleted_at) then
      raise exception 'IMAGE_METADATA_TRANSITION_INVALID';
    end if;
  elsif new.status = 'deleting' then
    if (
      new.etag,
      new.failure_code,
      new.uploaded_at,
      new.verified_at,
      new.deleted_at
    ) is distinct from (
      old.etag,
      old.failure_code,
      old.uploaded_at,
      old.verified_at,
      old.deleted_at
    ) or new.is_primary then
      raise exception 'IMAGE_METADATA_TRANSITION_INVALID';
    end if;
  elsif old.status = 'deleting' and new.status = 'deleted' then
    if (new.etag, new.failure_code, new.uploaded_at, new.verified_at) is distinct from
       (old.etag, old.failure_code, old.uploaded_at, old.verified_at) or
       new.is_primary or new.deleted_at is null then
      raise exception 'IMAGE_METADATA_TRANSITION_INVALID';
    end if;
  end if;

  return new;
end;
$$;

create trigger inventory_product_images_protect
before update or delete on public.inventory_product_images
for each row execute function public.protect_inventory_product_image();

create trigger inventory_product_images_set_updated_at
before update on public.inventory_product_images
for each row execute function public.set_admin_workspace_updated_at();

create function public.reserve_inventory_product_image(
  p_client_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid,
  p_content_type text,
  p_byte_size bigint,
  p_checksum_sha256 text
)
returns table(
  image_id uuid,
  image_object_key text,
  image_position smallint,
  image_upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_position smallint;
  selected_expiry timestamptz := now() + interval '5 minutes';
begin
  perform product.id
  from public.inventory_products as product
  join public.client_branches as branch
    on branch.client_id = product.client_id and branch.id = product.branch_id
  where product.id = p_product_id
    and product.client_id = p_client_id
    and product.branch_id = p_branch_id
    and branch.is_active
  for update of product;

  if not found then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;

  update public.inventory_product_images
  set status = 'failed', failure_code = 'UPLOAD_EXPIRED', is_primary = false
  where client_id = p_client_id
    and branch_id = p_branch_id
    and product_id = p_product_id
    and status = 'pending'
    and upload_expires_at <= now();

  select slot::smallint
  into selected_position
  from generate_series(1, 3) as candidate(slot)
  where not exists (
    select 1
    from public.inventory_product_images as image
    where image.client_id = p_client_id
      and image.branch_id = p_branch_id
      and image.product_id = p_product_id
      and image.position = slot
      and image.status in ('pending', 'ready', 'deleting')
  )
  order by slot
  limit 1;

  if selected_position is null then
    raise exception 'IMAGE_LIMIT_REACHED';
  end if;

  return query
  insert into public.inventory_product_images (
    client_id,
    branch_id,
    product_id,
    content_type,
    byte_size,
    checksum_sha256,
    position,
    upload_expires_at,
    created_by
  ) values (
    p_client_id,
    p_branch_id,
    p_product_id,
    p_content_type,
    p_byte_size,
    p_checksum_sha256,
    selected_position,
    selected_expiry,
    p_actor_user_id
  )
  returning
    id,
    object_key,
    position,
    upload_expires_at;
end;
$$;

create function public.finalize_inventory_product_image(
  p_client_id uuid,
  p_image_id uuid,
  p_etag text,
  p_uploaded_at timestamptz
)
returns table(
  image_id uuid,
  image_product_id uuid,
  image_position smallint,
  image_is_primary boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.inventory_product_images%rowtype;
begin
  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id;

  if not found then
    raise exception 'IMAGE_NOT_FOUND';
  end if;

  perform id
  from public.inventory_products
  where id = target.product_id
    and client_id = target.client_id
    and branch_id = target.branch_id
  for update;

  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id
  for update;

  if p_etag is null or char_length(btrim(p_etag)) not between 1 and 200 then
    raise exception 'INVALID_IMAGE_ETAG';
  end if;

  if p_uploaded_at is null or p_uploaded_at > target.upload_expires_at then
    raise exception 'IMAGE_UPLOAD_EXPIRED';
  end if;

  if target.status = 'ready' then
    if target.etag <> btrim(p_etag) then
      raise exception 'IMAGE_ETAG_CONFLICT';
    end if;
    return query select target.id, target.product_id, target.position, target.is_primary;
    return;
  end if;

  if target.status <> 'pending' then
    raise exception 'IMAGE_NOT_FINALIZABLE';
  end if;

  update public.inventory_product_images as image
  set status = 'ready',
      etag = btrim(p_etag),
      uploaded_at = p_uploaded_at,
      verified_at = now(),
      failure_code = null,
      is_primary = not exists (
        select 1
        from public.inventory_product_images as current_primary
        where current_primary.client_id = target.client_id
          and current_primary.branch_id = target.branch_id
          and current_primary.product_id = target.product_id
          and current_primary.status = 'ready'
          and current_primary.is_primary
      )
  where image.id = target.id
  returning image.* into target;

  return query select target.id, target.product_id, target.position, target.is_primary;
end;
$$;

create function public.fail_inventory_product_image(
  p_client_id uuid,
  p_image_id uuid,
  p_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_failure_code is null
    or char_length(p_failure_code) not between 1 and 80
    or p_failure_code !~ '^[A-Z0-9_]+$'
  then
    raise exception 'INVALID_IMAGE_FAILURE_CODE';
  end if;

  update public.inventory_product_images
  set status = 'failed', failure_code = p_failure_code, is_primary = false
  where id = p_image_id and client_id = p_client_id and status = 'pending';

  get diagnostics changed = row_count;
  return changed = 1 or exists (
    select 1 from public.inventory_product_images
    where id = p_image_id and client_id = p_client_id and status = 'failed'
  );
end;
$$;

create function public.begin_inventory_product_image_delete(
  p_client_id uuid,
  p_image_id uuid
)
returns table(
  image_object_key text,
  image_status text,
  image_product_id uuid,
  image_branch_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.inventory_product_images%rowtype;
begin
  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id;

  if not found then
    raise exception 'IMAGE_NOT_FOUND';
  end if;

  perform id
  from public.inventory_products
  where id = target.product_id
    and client_id = target.client_id
    and branch_id = target.branch_id
  for update;

  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id
  for update;

  if target.status in ('pending', 'ready', 'failed') then
    update public.inventory_product_images as image
    set status = 'deleting', is_primary = false
    where image.id = target.id
    returning image.* into target;
  elsif target.status not in ('deleting', 'deleted') then
    raise exception 'IMAGE_NOT_DELETABLE';
  end if;

  return query select target.object_key, target.status, target.product_id, target.branch_id;
end;
$$;

create function public.complete_inventory_product_image_delete(
  p_client_id uuid,
  p_image_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.inventory_product_images%rowtype;
  replacement_id uuid;
begin
  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id;

  if not found then
    raise exception 'IMAGE_NOT_FOUND';
  end if;

  if target.status = 'deleted' then
    return true;
  end if;

  perform id
  from public.inventory_products
  where id = target.product_id
    and client_id = target.client_id
    and branch_id = target.branch_id
  for update;

  select * into target
  from public.inventory_product_images
  where id = p_image_id and client_id = p_client_id
  for update;

  if target.status <> 'deleting' then
    raise exception 'IMAGE_DELETE_NOT_STARTED';
  end if;

  update public.inventory_product_images
  set status = 'deleted', deleted_at = now(), is_primary = false
  where id = target.id;

  if not exists (
    select 1
    from public.inventory_product_images
    where client_id = target.client_id
      and branch_id = target.branch_id
      and product_id = target.product_id
      and status = 'ready'
      and is_primary
  ) then
    select id into replacement_id
    from public.inventory_product_images
    where client_id = target.client_id
      and branch_id = target.branch_id
      and product_id = target.product_id
      and status = 'ready'
    order by position, created_at, id
    limit 1;

    if replacement_id is not null then
      update public.inventory_product_images
      set is_primary = true
      where id = replacement_id;
    end if;
  end if;

  return true;
end;
$$;

alter table public.inventory_product_images enable row level security;
alter table public.inventory_product_images force row level security;

revoke all on table public.inventory_product_images
  from public, anon, authenticated, service_role;
grant select on table public.inventory_product_images to service_role;

revoke all on function public.protect_inventory_product_image()
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_inventory_product_image(uuid,uuid,uuid,uuid,text,bigint,text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_inventory_product_image(uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_inventory_product_image(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_inventory_product_image_delete(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_inventory_product_image_delete(uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_inventory_product_image(uuid,uuid,uuid,uuid,text,bigint,text)
  to service_role;
grant execute on function public.finalize_inventory_product_image(uuid,uuid,text,timestamptz)
  to service_role;
grant execute on function public.fail_inventory_product_image(uuid,uuid,text)
  to service_role;
grant execute on function public.begin_inventory_product_image_delete(uuid,uuid)
  to service_role;
grant execute on function public.complete_inventory_product_image_delete(uuid,uuid)
  to service_role;

comment on table public.inventory_product_images is
  'Private S3 product-image metadata. Object bytes remain outside PostgreSQL.';

commit;
