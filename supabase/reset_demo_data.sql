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
--   - branches, products, POS sales, sale items, and stock movements
--   - client-managed inventory categories
--   - product-image metadata (S3 object bytes are NOT deleted by this SQL)
--   - delivery connections, mappings, events, orders, and delivery audit rows
--   - admin activity logs and emergency-login attempt counters

begin;

-- Truncation is intentional for this development-only reset. Migration 007 makes
-- the stock ledger append-only, so row-by-row DELETE is correctly rejected.
-- Listing every dependent table avoids CASCADE reaching preserved configuration.
-- Purge the development S3 clients/ prefix first if the files should also be
-- removed. Truncating metadata first would otherwise leave billable orphans.
truncate table
  public.delivery_order_items,
  public.delivery_events,
  public.delivery_product_mappings,
  public.delivery_orders,
  public.delivery_connections,
  public.delivery_audit,
  public.pos_sale_items,
  public.inventory_stock_movements,
  public.pos_sales,
  public.inventory_product_images,
  public.inventory_products,
  public.inventory_categories,
  public.client_module_access,
  public.client_portal_accounts,
  public.client_invitations,
  public.client_inquiry_links,
  public.client_subscriptions,
  public.client_branches,
  public.clients,
  public.consultation_requests,
  public.admin_activity_log,
  public.admin_emergency_login_attempts
restart identity;

-- A demo reset must never leave the prototype production processor approved.
update public.delivery_provider_settings
set production_enabled = false,
    approved_at = null
where provider = 'foodpanda';

-- Remove every non-admin Auth user only after delivery consent/audit references
-- and client accounts have been cleared. The admin guard preserves admins.
delete from auth.users as auth_user
where not exists (
  select 1
  from public.admin_users as admin_user
  where admin_user.user_id = auth_user.id
);

commit;

-- Expected after reset:
-- select count(*) from public.consultation_requests;       -- 0
-- select count(*) from public.clients;                    -- 0
-- select count(*) from public.client_portal_accounts;     -- 0
-- select count(*) from public.inventory_products;         -- 0
-- select count(*) from public.inventory_categories;       -- 0
-- select count(*) from public.inventory_product_images;   -- 0
-- select count(*) from public.pos_sales;                  -- 0
-- select count(*) from public.delivery_connections;       -- 0
-- select count(*) from public.delivery_orders;            -- 0
-- select count(*) from public.admin_users;                -- unchanged
-- select count(*) from public.subscription_plans;         -- unchanged
-- select count(*) from public.solution_modules;           -- unchanged
