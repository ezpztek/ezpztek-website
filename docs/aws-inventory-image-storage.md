# Private AWS S3 inventory images

This phase keeps Supabase as the database and authentication authority. AWS S3
stores only product-image bytes. Do not make the bucket public and do not put an
AWS access key in Vercel.

## 1. Apply the database migration

Run `supabase/migrations/202610120010_inventory_product_images.sql` in the
Supabase SQL editor after migrations 006 and 007. It creates the image metadata,
three-slot product limit, tenant/branch foreign key, lifecycle state machine,
and service-role-only functions.

This repository does not apply that migration automatically.

## 2. Create the bucket

In AWS S3, create one bucket for the environment, for example
`ezpztek-inventory-images-production`, in `ap-southeast-1` (Singapore).

- Keep all four **Block Public Access** settings enabled.
- Keep **ACLs disabled / bucket owner enforced**.
- Use the default S3-managed encryption (SSE-S3).
- Do not enable static website hosting.
- Keep versioning off initially unless a lifecycle rule also expires noncurrent
  versions; otherwise client deletions continue consuming storage.

The application writes keys below:

```text
clients/{clientId}/branches/{branchId}/products/{productId}/{imageId}.{jpg|png|webp}
```

Names supplied by the client are never used.

## 3. Add bucket CORS

Under **Permissions > Cross-origin resource sharing (CORS)**, replace the
example domains with the exact EZPZTEK production domains. Keep localhost only
for development:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://ezpztek.com",
      "https://www.ezpztek.com"
    ],
    "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 300
  }
]
```

Do not use `*` for `AllowedOrigins`.

## 4. Create the least-privilege role policy

Attach this permissions policy to the role used by Vercel. Replace the account
bucket name once in the resource value:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EZPZTEKInventoryImageObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::ezpztek-inventory-images-production/clients/*"
    }
  ]
}
```

The role does not need `s3:ListBucket`, bucket-policy changes, ACL access, or
permissions for any other bucket.

## 5. Trust only this Vercel project

In Vercel, use **Settings > Security > Secure backend access with OIDC
federation** and select Team issuer mode. In AWS IAM, add an OpenID Connect
provider whose provider URL is:

```text
https://oidc.vercel.com/TEAM_SLUG
```

Its audience is:

```text
https://vercel.com/TEAM_SLUG
```

Use a strict role trust policy and replace every uppercase placeholder:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/oidc.vercel.com/TEAM_SLUG"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/TEAM_SLUG:aud": "https://vercel.com/TEAM_SLUG",
          "oidc.vercel.com/TEAM_SLUG:sub": "owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production"
        }
      }
    }
  ]
}
```

Create a separate statement or role for Preview if previews must upload. Do not
replace the project name with `*` merely for convenience.

Reference: [Vercel's AWS OIDC setup](https://vercel.com/docs/oidc/aws).

## 6. Set environment variables

Local `.env.local`:

```dotenv
AWS_REGION=ap-southeast-2
AWS_S3_INVENTORY_BUCKET=ezpztek-inventory-images-development
AWS_ROLE_ARN=
```

Authenticate the local AWS SDK through an AWS CLI profile rather than storing
access keys in `.env.local`:

```powershell
aws configure --profile ezpztek-local
$env:AWS_PROFILE = "ezpztek-local"
npm.cmd run dev
```

In Vercel, set `AWS_REGION`, `AWS_S3_INVENTORY_BUCKET`, and `AWS_ROLE_ARN` for
Production. The Vercel OIDC provider supplies short-lived credentials at
runtime.

## 7. Verify locally

1. Start the app on port 3000 and sign in as an approved client with Inventory.
2. Open an existing product and upload a JPEG, PNG, or WebP under 5 MB.
3. Confirm the thumbnail appears in Inventory and POS.
4. Remove it and confirm the object no longer exists in S3.
5. Try a fourth image; the server must reject it.

The application calculates SHA-256 in the browser, binds it into the five-minute
S3 POST policy, then verifies S3 size, type, checksum, encryption, metadata, and
the first bytes of the image before display. A future hardening phase should use
Lambda to fully decode, strip metadata, resize, and re-encode every upload.

## Cost and cleanup guardrails

- Create an AWS Budget alert at a small threshold such as USD 5 and USD 10.
- Database reset SQL deletes metadata only. Purge the development bucket's
  `clients/` prefix first when a complete reset is intended.
- Add a scheduled cleanup job before production scale to remove expired pending
  objects and retain the failure tombstone in Supabase.
- Add per-client byte quotas to subscription plans before selling storage as an
  unlimited feature.

AWS references: [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configuring-block-public-access-bucket.html)
and [S3 CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).
