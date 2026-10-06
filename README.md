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

If SMTP is temporarily unavailable, the inquiry remains stored in Supabase and the visitor sees that their request was safely recorded.

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
- `public/ezpztek-logo.png` — supplied EZPZTEK logo
