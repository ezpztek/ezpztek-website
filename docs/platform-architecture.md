# EZPZTEK platform architecture decision

The current platform direction is intentionally hybrid:

- **Vercel** hosts the Next.js application and server-side routes.
- **Supabase** remains the source of truth for PostgreSQL data, authentication,
  tenant permissions, inventory, POS transactions, inquiries, clients, and
  subscriptions.
- **AWS S3** stores private inventory-product image bytes. Short-lived signed
  requests let browsers upload directly without sending files through Vercel.
- **Hostinger** continues to provide business email.

Product-image files do not pass through Vercel. An authorized Next.js route
reserves metadata in Supabase and creates a five-minute S3 upload policy bound
to one generated key, MIME type, byte size, and SHA-256 checksum. The browser
uploads directly to a private bucket. Another server route checks the S3
metadata and file signature before marking the image ready. Supabase stores the
object key and ownership metadata, never a public or signed URL.

The bucket has Block Public Access enabled. Client and branch identity always
comes from the authenticated portal session and composite database ownership
constraints. Only JPEG, PNG, and WebP images up to 5 MB are accepted, with a
maximum of three active image slots per product. Reads use expiring signed S3
URLs behind an authenticated same-origin redirect.

Vercel should assume a least-privilege AWS role through OIDC; permanent AWS
access keys are not required in production. Local development can use the
standard AWS CLI credential chain. A later image-processing Lambda can decode,
strip metadata, resize, and re-encode uploads before readiness. Database resets
do not delete S3 objects, so development object cleanup is a separate explicit
operation.

See [`aws-inventory-image-storage.md`](aws-inventory-image-storage.md) for the
bucket, CORS, IAM, and environment setup.

