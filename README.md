# EZPZTEK Landing Page

Phase 1 company landing page for EZPZTEK, built with Next.js App Router, TypeScript, and Tailwind CSS. It is ready to push to GitHub and import into Vercel.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Before deploying

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_CONTACT_EMAIL` to the real inbox that should receive consultation requests.
3. Run `npm run build`.
4. Push the folder to a GitHub repository.
5. Import that repository into Vercel. Vercel detects Next.js automatically.

The Phase 1 inquiry form opens a pre-filled draft in the visitor's email app. A Supabase-backed lead form can replace this in Phase 2 without changing the page structure.

## Main files

- `src/app/page.tsx` — landing-page content and sections
- `src/app/globals.css` — design system and responsive styling
- `src/components/contact-form.tsx` — consultation form behavior
- `public/ezpztek-logo.png` — supplied EZPZTEK logo
