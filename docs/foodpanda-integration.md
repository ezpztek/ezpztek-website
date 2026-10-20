# EZPZTEK branch-aware POS and delivery foundation

Prepared against repository commit `57daf616e4633042cf0d324e6eaf42a281d04f04`.
This is a development implementation, not an activated or certified foodpanda integration.

## Scope and hard boundary

Keep the existing Next.js application, Supabase database/authentication, Vercel deployment,
GitHub workflow and Hostinger domain/email. The public landing page and client invitation/login
flows are retained. The existing `client_id` remains the tenant identifier.

The implementation adds branch ownership, safer checkout retries, a delivery connection
wizard, product mappings, an isolated simulator, a durable inbox, order processing, bounded
retries, audit records and cancellation inventory review.

**The official foodpanda network adapter is not implemented.**
`POST /api/webhooks/foodpanda` always returns 503. It must not be configured as a live
provider endpoint. Changing an environment variable or a database approval flag does NOT
make this a working integration. The sandbox endpoint accepts an EZPZTEK-only schema and
HMAC protocol; those are explicitly not foodpanda's contract.

The one-account-per-client authentication model is preserved, not replaced. Staff accounts,
role-specific permissions and per-staff branch restrictions remain a separate implementation
requirement. Currently an approved client's POS account operates that client's branches.

## Architecture

```text
Client login -> existing requireClientModule -> server actions
                        |
                        +-> branch-aware POS RPC -> sale + items + stock ledger
                        |
                        +-> delivery dashboard -> owned connection / product mapping

EZPZTEK sandbox sender -> HMAC validation -> strict internal event parser
                        -> verified connection -> durable Supabase event inbox
                        -> bounded transactional worker -> normalized delivery order

Future approved Restaurant Plugin adapter -> same internal inbox
  [not connected; official payload/auth/response contract still required]
```

Sandbox and staging orders never deduct real inventory or create POS receipts. Prototype
production processing is separately gated in SQL and unreachable through the production
HTTP stub. The planned first real pilot uses the indirect model, not a newly invented OAuth
account-connect flow.

## Source map

| Area | Files |
| --- | --- |
| Branch migration and checkout | `supabase/migrations/202610120007_client_branches.sql` |
| Connection mapping and durable inbox | `supabase/migrations/202610120008_delivery_foundation.sql` |
| Transaction processing and replay | `supabase/migrations/202610120009_delivery_processing.sql` |
| Existing module actions | `src/app/portal/modules/actions.ts` |
| New client dashboard | `src/app/portal/modules/integrations/` |
| Internal schema and sandbox security | `src/lib/delivery/` |
| Sandbox receiver | `src/app/api/integrations/sandbox/foodpanda/route.ts` |
| Optional HTTP recovery worker | `src/app/api/internal/delivery/process/route.ts` |
| Disabled production boundary | `src/app/api/webhooks/foodpanda/route.ts` |
| Unit tests | `tests/delivery.test.mjs` |
| Database tests | `supabase/tests/delivery-*.sql` |

## Apply and validate in a separate development environment

Use the package's `apply.mjs` dry run first. It rejects dirty working trees, changed baseline
files, symlinks, new-file collisions and package checksum mismatches. Applying to `main`,
`master`, `production` or a detached HEAD is refused. It does not push, deploy or run SQL.

After applying on a review branch, run Node 22 and the repository's own dependencies:

```sh
npm ci
npm run test:delivery
npm run lint
npm run typecheck
npm run build
```

Use an isolated staging Supabase project with test data and separate Vercel preview secrets.
Never point a test preview or CI job at the live POS database. Confirm migrations 001-006
are already present; apply 007, 008 and 009 in order to the staging project. Each migration
has a transaction, but the three-file rollout is not a single transaction. Take and verify
a backup before a production rollout, and plan the schema/application cutover together.

The database CI job supplies a minimal disposable bootstrap for testing the dependency
surface of migration 006 plus 007-009. It is NOT a replacement for applying the complete
migration history to a staging copy of the real Supabase project. Never execute any file
under `supabase/tests/` against a real project.

## Migration behavior

Existing clients receive a Main branch. Existing products, stock movements, sales and line
items are backfilled into it without deliberately changing their quantities or amounts.
New clients automatically receive a Main branch. New branches begin empty: there is no
automatic stock transfer or catalog replication. The branch creation RPC caps a client
at 25 branches for this initial implementation.

Inventory remains product-per-branch rather than a global item master plus per-branch
balances. The same SKU may exist independently in separate branches. Composite foreign keys
reject a product mapping or sale line owned by another client or branch. Existing single-location
insert paths receive the primary branch, but old application versions are not safe for
multi-branch operation. Do not roll back the UI alone after using secondary branches.

The stock ledger rejects update/delete, including cascading deletion. Use reversible ledger
entries and soft deactivation, not hard-deleting clients or historical inventory. Review this
behavior with administrative deletion workflows before rollout.

## Authentication and tenant isolation

This application deliberately uses server-side Supabase `service_role` access. RLS is enabled,
but the service role bypasses it. Browser grants are revoked; authorization comes from the
existing authenticated client/module checks, explicitly scoped server queries and composite
ownership constraints. Never expose `SUPABASE_SECRET_KEY`, sandbox secrets or worker secrets
in `NEXT_PUBLIC_*` variables, browser JavaScript, screenshots or a repository.

A webhook cannot select `client_id` or `branch_id`. The gateway resolves those using the
server-owned connection. Unknown fields are rejected by the normalized parser. Invalid
signatures, oversized bodies, unknown stores and conflicting repeated event IDs are rejected.
Sandbox requests have a five-minute signature window and an initial 60-new-events-per-minute
per-store cap; duplicate events do not count as new events. Put a general HTTP/WAF rate limit
in front of this route before internet exposure. The demonstration HMAC secret is application-wide,
not an independently delegated merchant API key: do not distribute it to tenant staff.

## Development configuration

Append to the existing server environment, without replacing Supabase or SMTP settings:

```env
DELIVERY_SANDBOX_ENABLED=true
DELIVERY_SANDBOX_SECRET=<distinct-random-secret-at-least-32-characters>
DELIVERY_WORKER_SECRET=<another-distinct-random-secret-at-least-32-characters>
```

The example file defaults the sandbox to `false` and does not include credentials.
Generate a random secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not share the generated output publicly. Do not enable the sandbox in a production project
until its rate limits, retention policy and abuse monitoring are approved.

## Test the client workflow

Sign in using a staging client with the POS module assigned. Open Delivery integrations
from the sidebar. Add a branch only when needed, then add stock items through that branch's
existing Inventory module. Create an EZPZTEK sandbox connection, map a product to a stable
external code, and create a simulated order. Advance it through accepted/preparing/ready/
picked_up. Verify that it remains a simulation and does not change stock, cash or revenue.

Open two separate test clients and attempt cross-client branch, mapping, order and retry
operations. All such attempts must be rejected. Test checkout twice with the same request
ID, conflicting payloads, simultaneous sales of the last item and cancelled orders arriving
before their order snapshots. Reload a failed checkout and verify its request ID behavior.

The dashboard updates every 15 seconds while visible. This is authenticated polling, not
Supabase browser Realtime. The first version intentionally caps connection/product/order lists
and labels those limits. Add paginated search before supporting larger catalogs.

## Reliability and recovery

The receiver returns 202 only after the inbox insertion commits. Post-response `after()`
processing is a low-latency optimization, not the durable scheduler. Configure an independent
recovery runner before any real operation. Options are an authenticated POST to the worker
route or Supabase Cron invoking the database processor directly.

After enabling and verifying the Cron extension in staging, an operator can configure a
short recurring SQL job. Example only, not an automatically applied migration:

```sql
select cron.schedule(
  'ezpztek-delivery-inbox',
  '15 seconds',
  'select public.process_delivery_events(25, null);'
);
```

Confirm interval support in the project's PostgreSQL/Cron version. Choose exactly one primary
recovery mechanism; short batches are serialized with an advisory lock. Track oldest pending
event age, dead letters, error rate and worker availability. The initial serialized worker is
an MVP tradeoff; measure throughput and partition by tenant/branch before scaling.

Events retry with backoff and move to the recovery inbox after five failures. Fix the root
cause, then use the scoped audited retry action. The product mapping is frozen into an order
when its snapshot is first processed; later mapping edits do not alter an existing order.
An incompatible replacement snapshot is quarantined for review, not silently recalculated.

No retention purge or order-report reconciliation job is yet implemented. Specify retention,
backup restoration, privacy restrictions and an operator escalation policy before activation.
Do not automatically delete historical order/idempotency keys: doing so can permit duplicates.

## Stock and accounting policies

Walk-in checkout uses server-side product prices, locks stock rows in a stable order and
commits the sale/items/ledger together. A request ID returns the existing sale on a retry
only when the canonical request matches; conflicting reuse is rejected. A refreshed browser
may represent a new request, so operator receipt review is still required after ambiguity.

The prototype production processor uses the external merchandise snapshot, not walk-in
prices. Accepted orders deduct stock once; picked-up orders create one POS receipt with
`source='foodpanda'` and `payment_method='delivery'`, without deducting stock again. Receipt
posting at picked_up is a proposed operational policy, not confirmation of settlement.

Cancellation after stock deduction creates a review item. The operator either confirms all
items were unused and physically returned, or marks them consumed/prepared. Consumed items
are not deducted twice. Partial returns need a future per-line resolution workflow. A refund
or cancellation after pickup is quarantined as `REFUND_REVIEW_REQUIRED`.

Do not treat a delivery order as a second cash receipt. `collection` and channel totals are
not a payout ledger. Commission, tax, payment collection, tips, packaging charges, platform-
versus-merchant-funded discounts, refunds and settlement reconciliation require explicit
mapping and tests. They are not completed by this package. Likewise, recipe-based ingredient
consumption, modifiers, combos and partial-item cancellation need dedicated modeling before
restaurants using those features can go live.

## Official foodpanda onboarding: verify with the assigned contact

The public restaurant integration guide requires an NDA and confirmation before provider
integration development, followed by access, testing and a pilot. Credentials are requested
through foodpanda's process, including a PGP public key; they are not merchant login passwords.
Activation includes the integration/base URL, chain identifiers, vendor/country/remote ID
and chosen flow. Indirect flow forwards accepted orders after vendor-app handling and retains
that app as a fallback. Complete end-to-end testing with the assigned contact before activation.
Source: https://integration.foodpanda.com/en/documentation/

For EZPZTEK, collect the authorized restaurant administrator, branch addresses, verified vendor
and chain identifiers, consent and menu mapping. Confirm what account/provider scopes are
actually issued; never invent a per-merchant OAuth consent screen. This package records the
request and IDs, but does not approve ownership automatically or store provider credentials.

## Go-live gates not completed in this package

1. Approved Restaurant Plugin and Middleware API adapter: exact authentication, routes,
   response/acknowledgment timing, token refresh, payload mapping, errors and retries.
2. Credential lifecycle, ownership verification, staging vendor configuration and certified
   test vectors. No production secrets are requested by this package.
3. Outbound status commands, catalog publication, item/store availability and durable outbox;
   order-report reconciliation after outages. A test status simulation is not a provider update.
4. All relevant restaurant menu/payment/fulfillment scenarios, refunds and cancellation policies.
5. Staff/branch roles, production subscription-entitlement policy, fraud/abuse review, observability,
   backups and recovery drills; account/connection offboarding and audited reactivation.
6. CI, actual Supabase migration test, browser UI verification, concurrency/load tests, pilot and
   rollout approval. Review hosting's commercial terms and resource limits before launch.

Only then implement the real endpoint, configure provider routing and approve production
settings through a controlled operator procedure. Leave the current 503 boundary intact
until that work is complete.

## Further implementation references

- Supabase RLS/service-role boundary: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase SQL functions: https://supabase.com/docs/guides/database/functions
- Supabase Cron: https://supabase.com/docs/guides/cron/quickstart
- Next.js post-response work: https://nextjs.org/docs/app/api-reference/functions/after

Recheck the installed Next.js documentation under `node_modules/next/dist/docs/` and any
repository agent instructions in Codex before adapting APIs. Dependency versions were preserved,
not upgraded or assumed to match another Next.js release.
