-- EZPZTEK DEVELOPMENT / DEMO DATA RESET
--
-- WARNING: This permanently deletes operational data from this Supabase project.
-- Run manually in the Supabase SQL Editor. Never add this file to migrations.
--
-- Preserved:
--   - admin_users and their Supabase Auth accounts
--   - subscription_plans
--   - solution_modules
--   - database tables, functions, policies, and other schema objects
--
-- Deleted:
--   - inquiries and inquiry/client links
--   - clients, subscriptions, invitations, and client portal accounts
--   - every non-admin Supabase Auth user, including orphaned registrations
--   - products, POS sales, sale items, and stock movements
--   - admin activity logs and emergency-login attempt counters

begin;

-- Remove every non-admin Auth user, including registrations that never obtained
-- a client_portal_accounts row. The admin guard protects administrator access.
delete from auth.users as auth_user
where not exists (
  select 1
  from public.admin_users as admin_user
  where admin_user.user_id = auth_user.id
);

-- Inventory and POS transaction history.
delete from public.pos_sale_items;
delete from public.inventory_stock_movements;
delete from public.pos_sales;
delete from public.inventory_products;

-- Client access and onboarding records.
delete from public.client_module_access;
delete from public.client_portal_accounts;
delete from public.client_invitations;

-- CRM and lead-conversion records.
delete from public.client_inquiry_links;
delete from public.client_subscriptions;
delete from public.clients;
delete from public.consultation_requests;

-- Operational logs and temporary throttling state.
delete from public.admin_activity_log;
delete from public.admin_emergency_login_attempts;

-- Reset numeric display IDs used by logs and line-item tables.
alter sequence if exists public.admin_activity_log_id_seq restart with 1;
alter sequence if exists public.pos_sale_items_id_seq restart with 1;
alter sequence if exists public.inventory_stock_movements_id_seq restart with 1;

commit;

-- Expected after reset:
-- select count(*) from public.consultation_requests;       -- 0
-- select count(*) from public.clients;                    -- 0
-- select count(*) from public.client_portal_accounts;     -- 0
-- select count(*) from public.inventory_products;         -- 0
-- select count(*) from public.pos_sales;                  -- 0
-- select count(*) from public.admin_users;                -- unchanged
-- select count(*) from public.subscription_plans;         -- unchanged
-- select count(*) from public.solution_modules;           -- unchanged
