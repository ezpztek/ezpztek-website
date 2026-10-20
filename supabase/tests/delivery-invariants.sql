-- Destructive test fixtures: only for the EMPTY, DISPOSABLE CI database.
-- Not executed during package authoring; run this before approving any migration.
create function pg_temp.delivery_event(remote_id text,order_id text,event_id text,state text,product_code text default null)
returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'eventId',event_id,
  'occurredAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'remoteStoreId',remote_id,'orderId',order_id,'status',state)
 || case when product_code is null then '{}'::jsonb else
 jsonb_build_object('order',jsonb_build_object('currency','PHP','subtotalCentavos',30000,
  'discountCentavos',1000,'totalCentavos',29000,'collection','platform',
  'items',jsonb_build_array(jsonb_build_object('externalProductId',product_code,
   'name','Channel coffee','quantity',2,'unitPriceCentavos',15000)))) end;
$$;
do $$
declare
 ca uuid:='00000000-0000-4000-8000-000000000001';
 cb uuid:='00000000-0000-4000-8000-000000000002';
 ba uuid; bb uuid; ba2 uuid; pa uuid; pb uuid; sandbox uuid; production uuid; other_store uuid;
 remote text; event_id uuid; event_again uuid; order_uuid uuid;
 before_stock integer; before_sales integer; payload jsonb; cart jsonb;
 request_uuid uuid:=gen_random_uuid(); sale1 uuid; sale2 uuid; n integer;
begin
 select id into ba from public.client_branches where client_id=ca and is_primary;
 select id into bb from public.client_branches where client_id=cb and is_primary;
 select id into pa from public.inventory_products where client_id=ca and sku='COFFEE';
 select id into pb from public.inventory_products where client_id=cb and sku='COFFEE';
 if ba is null or bb is null or not exists(select 1 from public.inventory_products where id=pa and branch_id=ba)
  then raise exception 'legacy product backfill failed'; end if;
 if (select stock_on_hand from public.inventory_products where id=pa)<>99 then raise exception 'legacy balance changed'; end if;
 if not exists(select 1 from public.pos_sales where client_id=ca and branch_id=ba) then raise exception 'legacy receipt missing'; end if;
 if exists(select 1 from public.pos_sale_items where client_id is null or branch_id is null)
  then raise exception 'legacy line ownership missing'; end if;
 raise notice 'PASS legacy data and default branch backfill';

 if has_table_privilege('authenticated','public.delivery_orders','SELECT')
   or has_table_privilege('anon','public.delivery_connections','SELECT')
   or has_function_privilege('authenticated','public.enqueue_delivery_event(uuid,jsonb)','EXECUTE')
   or has_table_privilege('service_role','public.delivery_provider_settings','UPDATE')
  then raise exception 'unexpected browser/operator privileges'; end if;
 raise notice 'PASS restricted grants and production activation boundary';

 ba2:=public.create_client_branch(ca,'Second branch');
 insert into public.delivery_connections(client_id,branch_id,environment,status,consent_by)
  values(ca,ba,'sandbox','active',ca) returning id,remote_store_id into sandbox,remote;
 insert into public.delivery_connections(client_id,branch_id,environment,status,consent_by)
  values(ca,ba2,'sandbox','active',ca) returning id into other_store;
 begin
  perform public.save_delivery_product_mapping(ca,sandbox,'foreign-product',pb,ca);
  raise exception 'cross-client mapping unexpectedly succeeded';
 exception when foreign_key_violation then null; end;
 begin
  perform public.save_delivery_product_mapping(ca,other_store,'foreign-branch',pa,ca);
  raise exception 'cross-branch mapping unexpectedly succeeded';
 exception when foreign_key_violation then null; end;
 perform public.save_delivery_product_mapping(ca,sandbox,'coffee',pa,ca);
 raise notice 'PASS tenant and branch foreign-key isolation';

 select stock_on_hand into before_stock from public.inventory_products where id=pa;
 select count(*) into before_sales from public.pos_sales;
 payload:=pg_temp.delivery_event(remote,'sandbox-order','sandbox-created','received','coffee');
 event_id:=public.enqueue_delivery_event(sandbox,payload);
 event_again:=public.enqueue_delivery_event(sandbox,payload);
 if event_id<>event_again then raise exception 'duplicate event was not deduplicated'; end if;
 begin
  perform public.enqueue_delivery_event(sandbox,payload||jsonb_build_object('status','accepted'));
  raise exception 'same key with different payload unexpectedly succeeded';
 exception when raise_exception then if SQLERRM<>'EVENT_ID_CONFLICT' then raise; end if; end;
 perform public.process_delivery_events(25,ca);
 perform public.enqueue_delivery_event(sandbox,pg_temp.delivery_event(remote,'sandbox-order','sandbox-accepted','accepted'));
 perform public.process_delivery_events(25,ca);
 perform public.enqueue_delivery_event(sandbox,pg_temp.delivery_event(remote,'sandbox-order','sandbox-picked','picked_up'));
 perform public.process_delivery_events(25,ca);
 if (select stock_on_hand from public.inventory_products where id=pa)<>before_stock
  or (select count(*) from public.pos_sales)<>before_sales then raise exception 'sandbox changed stock or sales'; end if;
 if (select count(*) from public.delivery_orders where connection_id=sandbox and external_order_id='sandbox-order')<>1
  then raise exception 'duplicate or missing order'; end if;
 raise notice 'PASS event idempotency and sandbox stock/revenue isolation';

 perform public.enqueue_delivery_event(sandbox,pg_temp.delivery_event(remote,'cancel-first','cancel-first-cancelled','cancelled'));
 perform public.process_delivery_events(25,ca);
 perform public.enqueue_delivery_event(sandbox,pg_temp.delivery_event(remote,'cancel-first','cancel-first-created','received','coffee'));
 perform public.process_delivery_events(25,ca);
 if (select status from public.delivery_orders where connection_id=sandbox and external_order_id='cancel-first') is distinct from 'cancelled'
  then raise exception 'cancelled order resurrected'; end if;
 raise notice 'PASS cancellation before order dispatch';

 event_id:=public.enqueue_delivery_event(sandbox,pg_temp.delivery_event(remote,'missing-map','missing-map-created','received','new-code'));
 for n in 1..5 loop
  update public.delivery_events set next_attempt_at=now() where id=event_id;
  perform public.process_delivery_events(25,ca);
 end loop;
 if not exists(select 1 from public.delivery_events where id=event_id and status='dead' and attempts=5
  and last_error='PRODUCT_MAPPING_MISSING') then raise exception 'dead-letter policy failed'; end if;
 begin
  perform public.retry_delivery_event(cb,event_id,cb); raise exception 'cross-tenant retry succeeded';
 exception when raise_exception then if SQLERRM<>'EVENT_NOT_RETRYABLE' then raise; end if; end;
 perform public.save_delivery_product_mapping(ca,sandbox,'new-code',pa,ca);
 perform public.retry_delivery_event(ca,event_id,ca); perform public.process_delivery_events(25,ca);
 if not exists(select 1 from public.delivery_events where id=event_id and status='processed') then raise exception 'controlled replay failed'; end if;
 raise notice 'PASS bounded retries, dead-letter recovery and replay ownership';

 cart:=jsonb_build_array(jsonb_build_object('productId',pa,'quantity',1));
 select stock_on_hand into before_stock from public.inventory_products where id=pa;
 select sale_id into sale1 from public.complete_branch_pos_sale(ca,ba,ca,cart,'gcash',null,request_uuid);
 select sale_id into sale2 from public.complete_branch_pos_sale(ca,ba,ca,cart,'gcash',null,request_uuid);
 if sale1<>sale2 or (select stock_on_hand from public.inventory_products where id=pa)<>before_stock-1
  then raise exception 'POS retry duplicated receipt or stock'; end if;
 begin
  perform public.complete_branch_pos_sale(ca,ba,ca,cart,'card',null,request_uuid);
  raise exception 'changed checkout payload reused request';
 exception when raise_exception then if SQLERRM<>'REQUEST_REUSED' then raise; end if; end;
 begin
  perform public.complete_branch_pos_sale(ca,ba,ca,jsonb_build_array(jsonb_build_object('productId',pb,'quantity',1)),'card',null,gen_random_uuid());
  raise exception 'cross-client checkout succeeded';
 exception when raise_exception then if SQLERRM<>'PRODUCT_UNAVAILABLE' then raise; end if; end;
 raise notice 'PASS POS checkout idempotency and cross-client rejection';

 insert into public.delivery_connections(client_id,branch_id,environment,status,vendor_code,chain_code,verified_at,consent_by)
  values(ca,ba,'production','active','test-vendor','test-chain',now(),ca) returning id,remote_store_id into production,remote;
 perform public.save_delivery_product_mapping(ca,production,'coffee',pa,ca);
 begin
  perform public.enqueue_delivery_event(production,pg_temp.delivery_event(remote,'live-blocked','live-blocked-event','accepted','coffee'));
  raise exception 'unapproved production was enabled';
 exception when raise_exception then if SQLERRM<>'PROVIDER_NOT_APPROVED' then raise; end if; end;
 -- Test-only change, by disposable database administrator; never a deployment step.
 update public.delivery_provider_settings set production_enabled=true,approved_at=now();
 select stock_on_hand into before_stock from public.inventory_products where id=pa;
 payload:=pg_temp.delivery_event(remote,'live-order','live-accepted','accepted','coffee');
 perform public.enqueue_delivery_event(production,payload); perform public.process_delivery_events(25,ca);
 perform public.enqueue_delivery_event(production,payload||jsonb_build_object('eventId','second-event-same-order'));
 perform public.process_delivery_events(25,ca);
 if (select stock_on_hand from public.inventory_products where id=pa)<>before_stock-2
  then raise exception 'provider order stock was deducted twice or not deducted'; end if;
 perform public.enqueue_delivery_event(production,pg_temp.delivery_event(remote,'live-order','live-picked-up','picked_up'));
 perform public.process_delivery_events(25,ca);
 select sale_id into sale1 from public.delivery_orders where connection_id=production and external_order_id='live-order';
 if not exists(select 1 from public.pos_sales where id=sale1 and source='foodpanda' and payment_method='delivery' and total_centavos=29000)
  then raise exception 'provider price or payment accounting incorrect'; end if;
 if (select stock_on_hand from public.inventory_products where id=pa)<>before_stock-2 then raise exception 'posting receipt deducted stock again'; end if;
 raise notice 'PASS production gate, provider prices and one stock/receipt effect';

 perform public.enqueue_delivery_event(production,pg_temp.delivery_event(remote,'cancel-after-accept','accepted-to-cancel','accepted','coffee'));
 perform public.process_delivery_events(25,ca);
 select stock_on_hand into before_stock from public.inventory_products where id=pa;
 perform public.enqueue_delivery_event(production,pg_temp.delivery_event(remote,'cancel-after-accept','cancelled-after-accept','cancelled'));
 perform public.process_delivery_events(25,ca);
 select id into order_uuid from public.delivery_orders where connection_id=production and external_order_id='cancel-after-accept' and inventory_state='review';
 if order_uuid is null or (select stock_on_hand from public.inventory_products where id=pa)<>before_stock
  then raise exception 'prepared food was automatically restocked'; end if;
 begin
  perform public.resolve_delivery_inventory(cb,order_uuid,cb,'restocked'); raise exception 'cross-tenant restock succeeded';
 exception when raise_exception then if SQLERRM<>'ORDER_NOT_RESTOCKABLE' then raise; end if; end;
 perform public.resolve_delivery_inventory(ca,order_uuid,ca,'restocked');
 if (select stock_on_hand from public.inventory_products where id=pa)<>before_stock+2 then raise exception 'verified restock failed'; end if;
 begin
  perform public.resolve_delivery_inventory(ca,order_uuid,ca,'restocked'); raise exception 'duplicate restock succeeded';
 exception when raise_exception then if SQLERRM<>'ORDER_NOT_RESTOCKABLE' then raise; end if; end;
 raise notice 'PASS cancellation review, restoration ownership and duplicate prevention';

 begin
  update public.inventory_stock_movements set note='rewrite history' where product_id=pa;
  raise exception 'ledger mutation succeeded';
 exception when raise_exception then if SQLERRM<>'STOCK_LEDGER_APPEND_ONLY' then raise; end if; end;
 raise notice 'PASS append-only stock ledger';
end;
$$;
