-- Internal normalized-event processor. No provider network calls in SQL.
begin;
create function public.apply_delivery_event(p_event_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  e public.delivery_events%rowtype;
  c public.delivery_connections%rowtype;
  o public.delivery_orders%rowtype;
  item record;
  stock record;
  mapped_product uuid;
  snapshot jsonb;
  incoming text;
  next_status text;
  next_time timestamptz;
  event_time timestamptz;
  subtotal bigint;
  computed numeric;
  discount bigint;
  total bigint;
  sale_uuid uuid;
  receipt text;
begin
  select * into e from public.delivery_events where id=p_event_id for update;
  if not found or e.status='processed' then return; end if;
  select * into c from public.delivery_connections where id=e.connection_id;
  if c.environment<>'sandbox' and not exists (
    select 1 from public.delivery_provider_settings where provider=c.provider and production_enabled
  ) then raise exception 'PROVIDER_NOT_APPROVED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.id::text||':'||e.external_order_id,0));
  insert into public.delivery_orders(client_id,branch_id,connection_id,external_order_id)
    values (c.client_id,c.branch_id,c.id,e.external_order_id)
    on conflict(connection_id,external_order_id) do nothing;
  select * into o from public.delivery_orders
    where connection_id=c.id and external_order_id=e.external_order_id for update;
  incoming:=e.payload->>'status';
  event_time:=(e.payload->>'occurredAt')::timestamptz;
  if event_time is null or event_time>clock_timestamp()+interval '5 minutes' then
    raise exception 'INVALID_EVENT_TIME';
  end if;
  if incoming is null or incoming not in ('received','accepted','preparing','ready','picked_up','cancelled','rejected') then
    raise exception 'INVALID_STATUS';
  end if;
  snapshot:=e.payload->'order';
  if snapshot is not null then
    if o.snapshot is not null and o.snapshot is distinct from snapshot then
      raise exception 'ORDER_SNAPSHOT_CONFLICT';
    end if;
    if o.snapshot is null then
      if snapshot->>'currency' is distinct from 'PHP'
        or jsonb_typeof(snapshot->'items') is distinct from 'array' then raise exception 'INVALID_SNAPSHOT'; end if;
      if jsonb_array_length(snapshot->'items') not between 1 and 50 then raise exception 'INVALID_ITEMS'; end if;
      if exists (select 1 from jsonb_array_elements(snapshot->'items') x
        where jsonb_typeof(x->'quantity') is distinct from 'number'
        or jsonb_typeof(x->'unitPriceCentavos') is distinct from 'number'
        or (x->>'quantity')::numeric<>trunc((x->>'quantity')::numeric)
        or (x->>'unitPriceCentavos')::numeric<>trunc((x->>'unitPriceCentavos')::numeric)) then
        raise exception 'INVALID_MONEY_OR_QUANTITY';
      end if;
      subtotal:=(snapshot->>'subtotalCentavos')::bigint;
      discount:=(snapshot->>'discountCentavos')::bigint;
      total:=(snapshot->>'totalCentavos')::bigint;
      select sum((x->>'quantity')::numeric*(x->>'unitPriceCentavos')::numeric)
        into computed from jsonb_array_elements(snapshot->'items') x;
      if subtotal is null or discount is null or total is null or computed<>subtotal
        or discount<0 or discount>subtotal or total<>subtotal-discount
        or total not between 0 and 1000000000000 then raise exception 'TOTAL_MISMATCH'; end if;
      for item in select value,ordinality from jsonb_array_elements(snapshot->'items') with ordinality loop
        select product_id into mapped_product from public.delivery_product_mappings
          where connection_id=c.id and external_product_id=item.value->>'externalProductId';
        if mapped_product is null then raise exception 'PRODUCT_MAPPING_MISSING'; end if;
        insert into public.delivery_order_items(
          order_id,client_id,branch_id,line_number,product_id,external_product_id,product_name,quantity,unit_price_centavos
        ) values (o.id,c.client_id,c.branch_id,item.ordinality,mapped_product,
          item.value->>'externalProductId',item.value->>'name',
          (item.value->>'quantity')::integer,(item.value->>'unitPriceCentavos')::bigint);
      end loop;
      update public.delivery_orders set snapshot=e.payload->'order',total_centavos=total,
        collection=(e.payload->'order')->>'collection' where id=o.id;
      o.snapshot:=snapshot;
    end if;
  end if;
  if incoming='received' and o.snapshot is null then raise exception 'MISSING_ORDER'; end if;
  if o.status='picked_up' and incoming in ('cancelled','rejected') then raise exception 'REFUND_REVIEW_REQUIRED'; end if;
  next_status:=o.status;
  next_time:=o.status_at;
  if o.status not in ('cancelled','rejected','picked_up') and event_time>=o.status_at then
    if incoming in ('cancelled','rejected') or
      array_position(array['received','accepted','preparing','ready','picked_up'],incoming)>=
      array_position(array['received','accepted','preparing','ready','picked_up'],o.status) then
      next_status:=incoming;
      if incoming<>o.status or o.status_at='1970-01-01T00:00:00Z'::timestamptz then next_time:=event_time; end if;
    end if;
  end if;

  -- Test and staging connections cannot mutate real stock, cash or POS receipts.
  if c.environment='production' and o.snapshot is not null and o.inventory_state='none'
    and next_status in ('accepted','preparing','ready','picked_up') then
    perform p.id from public.inventory_products p
      where p.id in (select product_id from public.delivery_order_items where order_id=o.id)
      order by p.id for update;
    for stock in
      select p.id,p.stock_on_hand,p.is_active,sum(i.quantity)::integer quantity
      from public.delivery_order_items i join public.inventory_products p on p.id=i.product_id
      where i.order_id=o.id group by p.id order by p.id
    loop
      if not stock.is_active or stock.stock_on_hand<stock.quantity then raise exception 'OUT_OF_STOCK'; end if;
      update public.inventory_products set stock_on_hand=stock_on_hand-stock.quantity,
        updated_at=now() where id=stock.id;
      insert into public.inventory_stock_movements(client_id,product_id,movement_type,
        quantity_change,balance_after,reference_type,reference_id,note)
      values(c.client_id,stock.id,'sale',-stock.quantity,stock.stock_on_hand-stock.quantity,
        'delivery_order',o.id::text,'Confirmed foodpanda order');
    end loop;
    update public.delivery_orders set inventory_state='deducted' where id=o.id;
    o.inventory_state:='deducted';
  end if;
  if next_status in ('cancelled','rejected') and o.inventory_state='deducted' then
    update public.delivery_orders set inventory_state='review' where id=o.id;
  end if;
  -- Merchandise accounting policy only. Real settlement/tax/refund mapping
  -- must be agreed before activating the provider adapter.
  if c.environment='production' and next_status='picked_up' and o.snapshot is not null and o.sale_id is null then
    sale_uuid:=gen_random_uuid(); receipt:='FP-'||upper(replace(sale_uuid::text,'-',''));
    insert into public.pos_sales(id,client_id,branch_id,receipt_number,subtotal_centavos,
      discount_centavos,total_centavos,payment_method,source)
    values(sale_uuid,c.client_id,c.branch_id,receipt,(o.snapshot->>'subtotalCentavos')::bigint,
      (o.snapshot->>'discountCentavos')::bigint,(o.snapshot->>'totalCentavos')::bigint,'delivery','foodpanda');
    insert into public.pos_sale_items(sale_id,product_id,sku,product_name,quantity,unit_price_centavos,line_total_centavos)
    select sale_uuid,i.product_id,p.sku,i.product_name,i.quantity,i.unit_price_centavos,
      i.quantity*i.unit_price_centavos from public.delivery_order_items i
      join public.inventory_products p on p.id=i.product_id where i.order_id=o.id;
    update public.delivery_orders set sale_id=sale_uuid where id=o.id;
  end if;
  update public.delivery_orders set status=next_status,status_at=next_time,updated_at=now() where id=o.id;
  update public.delivery_events set status='processed',processed_at=now(),last_error=null where id=e.id;
end;
$$;

create function public.process_delivery_events(p_limit integer default 25,p_client_id uuid default null)
returns integer language plpgsql set search_path = '' as $$
declare e record; done integer:=0; safe_error text;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_BATCH_SIZE'; end if;
  -- Small MVP batches are serialized to avoid cross-order lock cycles. Scale
  -- by partitioning on tenant/branch after measured throughput tests.
  if not pg_try_advisory_xact_lock(202610120009::bigint) then return 0; end if;
  for e in select id,attempts from public.delivery_events
    where status in ('pending','retry') and next_attempt_at<=now()
      and (p_client_id is null or client_id=p_client_id)
    order by received_at,id limit p_limit for update skip locked
  loop
    begin
      perform public.apply_delivery_event(e.id);
      update public.delivery_events set attempts=attempts+1 where id=e.id;
      done:=done+1;
    exception when others then
      safe_error:=case when SQLERRM in ('PROVIDER_NOT_APPROVED','INVALID_EVENT_TIME',
        'INVALID_STATUS','ORDER_SNAPSHOT_CONFLICT','INVALID_SNAPSHOT','INVALID_ITEMS',
        'INVALID_MONEY_OR_QUANTITY','TOTAL_MISMATCH','PRODUCT_MAPPING_MISSING',
        'MISSING_ORDER','REFUND_REVIEW_REQUIRED','OUT_OF_STOCK') then SQLERRM else 'PROCESSING_ERROR' end;
      update public.delivery_events set attempts=e.attempts+1,
        status=case when e.attempts+1>=5 then 'dead' else 'retry' end,last_error=safe_error,
        next_attempt_at=now()+make_interval(secs=>least(300,(power(2,e.attempts+1)*5)::integer))
        where id=e.id;
    end;
  end loop;
  return done;
end;
$$;
create function public.retry_delivery_event(p_client_id uuid,p_event_id uuid,p_actor_user_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  update public.delivery_events set status='pending',attempts=0,next_attempt_at=now(),last_error=null
    where id=p_event_id and client_id=p_client_id and status in ('retry','dead');
  if not found then raise exception 'EVENT_NOT_RETRYABLE'; end if;
  insert into public.delivery_audit(client_id,actor_user_id,action,entity_id)
    values(p_client_id,p_actor_user_id,'event_retry',p_event_id);
end;
$$;
create function public.resolve_delivery_inventory(
  p_client_id uuid,p_order_id uuid,p_actor_user_id uuid,p_resolution text
)
returns void language plpgsql set search_path = '' as $$
declare o public.delivery_orders%rowtype; stock record;
begin
  if p_resolution is null or p_resolution not in ('restocked','consumed') then
    raise exception 'INVALID_RESOLUTION';
  end if;
  select * into o from public.delivery_orders where id=p_order_id and client_id=p_client_id for update;
  if not found or o.inventory_state<>'review' or o.status not in ('cancelled','rejected') then
    raise exception 'ORDER_NOT_RESTOCKABLE';
  end if;
  if p_resolution='restocked' then
    perform p.id from public.inventory_products p
      where p.id in (select product_id from public.delivery_order_items where order_id=o.id)
      order by p.id for update;
    for stock in select p.id,p.stock_on_hand,sum(i.quantity)::integer quantity
      from public.delivery_order_items i join public.inventory_products p on p.id=i.product_id
      where i.order_id=o.id group by p.id order by p.id
    loop
      update public.inventory_products set stock_on_hand=stock_on_hand+stock.quantity,
        updated_at=now() where id=stock.id;
      insert into public.inventory_stock_movements(client_id,product_id,movement_type,
        quantity_change,balance_after,reference_type,reference_id,note,actor_user_id)
      values(o.client_id,stock.id,'return',stock.quantity,stock.stock_on_hand+stock.quantity,
        'delivery_return',o.id::text,'Operator verified unused returned stock',p_actor_user_id);
    end loop;
  end if;
  update public.delivery_orders set inventory_state=p_resolution,updated_at=now() where id=o.id;
  insert into public.delivery_audit(client_id,actor_user_id,action,entity_id)
    values(o.client_id,p_actor_user_id,'cancelled_stock_'||p_resolution,o.id);
end;
$$;
revoke all on function public.apply_delivery_event(uuid),public.process_delivery_events(integer,uuid),
  public.retry_delivery_event(uuid,uuid,uuid),public.resolve_delivery_inventory(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.apply_delivery_event(uuid),public.process_delivery_events(integer,uuid),
  public.retry_delivery_event(uuid,uuid,uuid),public.resolve_delivery_inventory(uuid,uuid,uuid,text)
  to service_role;
commit;
