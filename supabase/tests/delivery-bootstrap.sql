-- Empty, disposable PostgreSQL database ONLY. Never run on a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create table public.clients(
  id uuid primary key default gen_random_uuid(),
  business_name text not null,contact_name text not null,contact_email text not null
);
create function public.set_admin_workspace_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;
grant usage on schema public,auth to service_role;
