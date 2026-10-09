# EZPZTEK Landing Page

Phase 1 company landing page for EZPZTEK, built with Next.js App Router, TypeScript, and Tailwind CSS. It includes a Supabase-backed consultation form and Hostinger Email confirmation workflow.

## Run locally

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configure consultation inquiries

### 1. Create the Supabase table

Create a Supabase project, open its SQL Editor, and run:

[`supabase/migrations/202610060001_create_consultation_requests.sql`](supabase/migrations/202610060001_create_consultation_requests.sql)

The migration enables Row Level Security, removes browser access, and grants access only to server-side code using Supabase's `service_role` database role.

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and replace every placeholder:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Public fallback email shown below the form |
| `SITE_URL` | Final public website origin, such as `https://www.ezpztek.com` |
| `RATE_LIMIT_SECRET` | Long random server-only value used to hash request fingerprints |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key from Supabase Connect |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key used only by the server-side admin authentication client |
| `ADMIN_EMERGENCY_PIN_HASH` | Optional server-only scrypt hash for rate-limited owner emergency access |
| `SMTP_HOST` | Hostinger SMTP host; normally `smtp.hostinger.com` |
| `SMTP_PORT` | `465` for SSL |
| `SMTP_SECURE` | `true` when using port 465 |
| `SMTP_USER` | Full Hostinger mailbox address |
| `SMTP_PASS` | Hostinger mailbox password |
| `SMTP_FROM_NAME` | Sender name shown to recipients |
| `CONTACT_TO_EMAIL` | Inbox that receives new inquiry notifications |

Never commit `.env.local`, the Supabase secret key, or the mailbox password.

The endpoint applies shared database-backed limits per website, email address, and a one-way hashed request fingerprint. Raw IP addresses are not stored. Add a verified CAPTCHA such as Cloudflare Turnstile before running a high-volume advertising campaign.

Hostinger documents SMTP over SSL on port 465. If SSL connectivity fails, its supported fallback is STARTTLS on port 587 with `SMTP_SECURE=false`.

### 3. Configure Vercel

Import the GitHub repository into Vercel, then add the variables above under **Project → Settings → Environment Variables**. Add them to Production and Preview as needed, then redeploy.

## Inquiry flow

1. The visitor submits the consultation form.
2. `/api/consultations` validates the request on the server.
3. Supabase saves the inquiry before any email is attempted.
4. Hostinger SMTP sends the visitor a confirmation email.
5. Hostinger SMTP sends EZPZTEK an internal notification with Reply-To set to the visitor.
6. Supabase records whether each email succeeded or failed.

If SMTP is temporarily unavailable, the inquiry remains stored in Supabase for follow-up.

## Configure the admin workspace

The protected workspace is available at [`/admin`](http://localhost:3000/admin). It includes:

- overview metrics for new inquiries, active clients, tracked monthly revenue, and follow-ups;
- a searchable inquiry inbox with statuses and internal notes;
- client records and lifecycle statuses;
- subscription assignment and renewal tracking;
- editable plan names, pricing, billing intervals, features, and availability;
- server-side authorization and an admin activity log.

### 1. Apply the admin migration

Run this file in the Supabase SQL Editor after the consultation migration:

[`supabase/migrations/202610060002_create_admin_workspace.sql`](supabase/migrations/202610060002_create_admin_workspace.sql)

### 2. Add the publishable key

Copy the **Publishable key** from the Supabase project's Connect dialog into
`.env.local` and Vercel:

```env
SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
```

This key is used by server-side Supabase Auth. The secret key remains server-only
and is never sent to the browser.

### 3. Create and authorize the owner account

In **Supabase → Authentication → Users**, create the account that will sign in to
the admin workspace. Then authorize that account in the SQL Editor, replacing the
example email and name:

```sql
insert into public.admin_users (user_id, display_name, role)
select id, 'Your Name', 'owner'
from auth.users
where email = 'you@yourdomain.com'
on conflict (user_id) do update
set display_name = excluded.display_name,
    role = excluded.role,
    is_active = true;
```

There is intentionally no public admin sign-up route. Every administrator must
first exist in Supabase Auth and then be explicitly authorized in `admin_users`.

### 4. Redeploy

Add `SUPABASE_PUBLISHABLE_KEY` to the same Vercel environments as the existing
Supabase variables, redeploy, then sign in at `/admin/login`.

### 5. Allow password-recovery redirects

In **Supabase → Authentication → URL Configuration**, add these development
redirect URLs:

```text
http://localhost:3000/**
http://127.0.0.1:3000/**
```

For production, set the Supabase **Site URL** to the public EZPZTEK domain:

```text
https://www.ezpztek.com
```

Then add the exact callback under **Redirect URLs**:

```text
https://www.ezpztek.com/admin/auth/callback
```

Set Vercel's `SITE_URL` environment variable to the same origin. The explicit
`SITE_URL` takes priority over localhost, including when a recovery request is
initiated from a local development server. Recovery links created before these
settings are corrected keep their old destination, so request a new email after
redeploying.

Administrators should request recovery emails from `/admin/forgot-password`.
The application supplies the callback destination, exchanges the one-time PKCE
code for a cookie session, verifies that the account is an active administrator,
and then allows the password to be changed at `/admin/reset-password`.

Supabase's built-in email service is intended for development and has a small
project-wide quota. If that quota is reached during local setup, reset the sole
active owner's password directly from an interactive project terminal:

```bash
npm run admin:reset-password
```

The command keeps the password hidden, requires confirmation, and sends it
directly to the Supabase Admin API. It does not write the password to a file.
For production recovery emails, configure the Hostinger mailbox under
**Supabase → Authentication → SMTP Settings**, then adjust the Auth email rate
limit to match the mailbox's safe sending limit.

### Optional emergency owner PIN

Emergency PIN access uses the existing Supabase owner account and creates a
normal protected Supabase session. The raw PIN is never stored by the website.

1. Run
   [`supabase/migrations/202610060003_add_emergency_admin_access.sql`](supabase/migrations/202610060003_add_emergency_admin_access.sql)
   in the Supabase SQL Editor.
2. Generate a hash from an interactive terminal:

   ```bash
   npm run admin:setup-pin
   ```

3. Choose a new PIN that has never been posted or shared. The command replaces
   `ADMIN_EMERGENCY_PIN_HASH` in `.env.local` automatically without storing the
   readable PIN.
4. Restart the local server. For production, copy only the updated hash value
   from `.env.local` into Vercel, then redeploy.

The login page then reveals an **Emergency owner access** option. Access is
limited to the sole active owner. Each request fingerprint receives five
attempts per 15-minute window; further attempts are locked for 15 minutes.
Remove `ADMIN_EMERGENCY_PIN_HASH` and redeploy whenever emergency access is no
longer needed.

## Client invitation and demo portal

The protected client workflow includes:

- admin-generated, single-use credential invitations sent through Hostinger SMTP;
- seven-day invitation expiry and automatic revocation when a new invite is sent;
- client registration followed by a pending-admin-approval screen;
- multiple selectable business modules per client;
- automatic free-demo approval email with the `/login` link;
- an approved client workspace that exposes only assigned modules;
- activity logging for invitations, approvals, and access changes.

Apply the portal migration after the admin migrations:

[`supabase/migrations/202610060004_create_client_portal.sql`](supabase/migrations/202610060004_create_client_portal.sql)

Then use **Admin → Client access**:

1. Add the business under **Clients** if it does not exist yet.
2. Send its private credential invitation.
3. Wait for the client to create their account. They will see a pending-approval page.
4. Select one or several modules and approve the free demo.
5. The client receives the approval email and signs in at `/login`.

Seeded modules include Inventory Management, Point of Sale, Item Stock Control,
Finance Management, Purchasing & Suppliers, Customer Management, Reports &
Analytics, and Staff & Access. The module pages are secure demo shells; live
inventory, transaction, and accounting records will be implemented in their
respective product phases.

### Qualified inquiry automation

Apply
[`supabase/migrations/202610060005_promote_qualified_inquiries.sql`](supabase/migrations/202610060005_promote_qualified_inquiries.sql)
after the admin workspace migration. From then on, saving an inquiry with the
**Qualified** status automatically creates or links its client record. Matching
is idempotent and email-aware, so saving the same inquiry again cannot duplicate
the client. **Sync qualified inquiries** on the Inquiries page backfills older
qualified leads and reports how many records were created or linked.

## Inventory, POS, and stock control

Apply
[`supabase/migrations/202610070006_create_inventory_pos.sql`](supabase/migrations/202610070006_create_inventory_pos.sql)
after the client portal migration. It adds a client-isolated product catalog,
POS receipts and line items, and an immutable stock-movement ledger.

The three modules share one stock balance:

- **Inventory Management** creates products, SKUs, optional barcodes, pricing,
  opening stock, reorder levels, and active/inactive availability.
- **Point of Sale** displays only active products whose stock is greater than
  zero. Checkout locks and rechecks every selected product, creates the receipt,
  and deducts stock in one database transaction.
- **Item Stock Control** records deliveries, returns, count adjustments,
  damage, and POS deductions with balance-after accountability.

If another checkout changes the final quantity first, the later sale is safely
rejected and no partial receipt or stock deduction is committed. All tables are
scoped by `client_id`, protected from browser access, and used only through
authorized server actions.

## Platform direction

The agreed Vercel + Supabase + Hostinger-media architecture is recorded in
[`docs/platform-architecture.md`](docs/platform-architecture.md). The Hostinger
media service is intentionally deferred until the inventory/POS phase.

## Verification

```bash
npm run lint
npm run build
```

## Main files

- `src/app/page.tsx` — landing-page content and sections
- `src/app/globals.css` — design system and responsive styling
- `src/components/contact-form.tsx` — consultation form UI and submission state
- `src/app/api/consultations/route.ts` — server-side database and email workflow
- `supabase/migrations/202610060001_create_consultation_requests.sql` — database schema and access controls
- `supabase/migrations/202610060002_create_admin_workspace.sql` — admin, client, plan, subscription, and audit schema
- `supabase/migrations/202610060003_add_emergency_admin_access.sql` — throttled emergency owner access
- `supabase/migrations/202610060004_create_client_portal.sql` — invitations, approvals, and modular client access
- `supabase/migrations/202610060005_promote_qualified_inquiries.sql` — qualified-lead client automation
- `supabase/migrations/202610070006_create_inventory_pos.sql` — shared inventory ledger, atomic POS, and stock control
- `src/app/admin` — protected operations workspace
- `src/app/(client-auth)` — client registration and login
- `src/app/portal` — protected client demo workspace
- `docs/platform-architecture.md` — saved platform architecture decision
- `public/ezpztek-logo.png` — supplied EZPZTEK logo
