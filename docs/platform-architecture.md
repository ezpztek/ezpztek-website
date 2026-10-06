# EZPZTEK platform architecture decision

The current platform direction is intentionally hybrid:

- **Vercel** hosts the Next.js application and server-side routes.
- **Supabase** remains the source of truth for PostgreSQL data, authentication,
  tenant permissions, inventory, POS transactions, inquiries, clients, and
  subscriptions.
- **Hostinger** provides business email and will later host compressed product
  images through a small secured media API.

Product-image files will not pass through Vercel. A signed request will allow an
authenticated browser to upload directly to a Hostinger media subdomain. The
Supabase database will keep the file key, URL, MIME type, byte size, checksum,
business owner, and timestamps.

The Hostinger media service is deferred until the inventory/POS phase. It must
validate signatures, tenant ownership, file type and size; generate random file
names; disable script execution in upload directories; compress images; enforce
per-client quotas; and support deletion and independent backups.

This design avoids a PostgreSQL-to-MySQL migration and lets EZPZTEK use its
existing Hostinger SSD capacity without coupling critical transaction data to
shared-hosting database limits.

