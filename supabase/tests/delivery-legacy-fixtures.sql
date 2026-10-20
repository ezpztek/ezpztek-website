-- Run BEFORE migration 007 in the disposable CI database to verify backfill.
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.clients values
 ('00000000-0000-4000-8000-000000000001','Restaurant A','Owner A','a@example.test'),
 ('00000000-0000-4000-8000-000000000002','Restaurant B','Owner B','b@example.test');
select public.create_inventory_product(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
 'COFFEE',null,'Coffee','Drinks','cup',10000,5000,100,5);
select public.create_inventory_product(
 '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',
 'COFFEE',null,'Private coffee','Drinks','cup',9000,4000,20,5);
select public.complete_pos_sale(
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',
 jsonb_build_array(jsonb_build_object('productId',
  (select id from public.inventory_products where client_id='00000000-0000-4000-8000-000000000001'),
  'quantity',1)),'gcash',null);
