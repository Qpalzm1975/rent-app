# Rentledger

A single-owner rental ledger for Australian room rentals. Functional Next.js 16.3.4 / TypeScript application; Supabase PostgreSQL; read-only Australian bank integration through Redbark's documented v2 API. No bank CSV import or credential scraping.

**Live activation requires your Supabase project, Redbark API key, CDR consent, production host, and scheduler. No real account has been connected or tested in this build.** `/demo` is an isolated, explicitly labelled sample workspace. It uses the same financial engine, but its changes live only in the current browser session and never reach the database or provider.

## Start here

1. Read [Deployment](docs/DEPLOYMENT.md). The same guide is available at `/deployment`.
2. Copy `.env.example` to `.env.local` and set your server credentials.
3. Run `pnpm install --frozen-lockfile` (Node 22.13+), then `pnpm dev:next` for local Next.js development.
4. Apply `supabase/migrations/202609280001_initial_ledger.sql` to Supabase.
5. Deploy to Vercel, complete property/room/tenant setup, connect a bank and select the rental account.
6. Activate signed webhooks and the 30-minute scheduler. Verify the first live bank and scheduled runs.

## Commands

- `pnpm dev:next` — standard Next.js development, localhost:3000.
- `pnpm build:vercel` / `pnpm start:next` — standard production Next.js build and server.
- `pnpm build` — Sites-compatible Vinext preview build; **not** the Vercel build command.
- `pnpm typecheck` — TypeScript check.
- `pnpm test` — financial, banking-contract, webhook and PostgreSQL integration tests.
- `node scripts/password-hash.mjs` — generate the single-owner password hash via hidden terminal input.
- `node scripts/configure-redbark.mjs` — interactive one-time provider destination/sync setup; credentials are read from the environment.

The Sites build is a private, owner-visible preview of the same app. Production uses Vercel because signed external callbacks must reach the webhook without a Sites login gate. The application source remains standard Next.js compatible. No third-party TCP database driver is needed: a strongly typed server repository calls transactional PostgreSQL RPC functions over HTTPS. This also makes the preview deployable to a Worker.

## What is implemented

- Properties, rooms, tenants, dated tenancies and immutable rent-rate history.
- Monday-default weekly rent generation; early/late payments, partial and combined payments, prepaid weeks and tenant credits.
- Fixed-precision integer cents; exact bill division including owner/vacant shares.
- Outgoing bill payments and incoming tenant reimbursements tracked separately.
- Posted-transaction ingestion, stable provider/account deduplication, pending visibility, changed-transaction quarantine.
- Conservative deterministic identity matching from aliases, editable rules, prior manually confirmed references, amount/date context and existing allocations. Ambiguity goes to review.
- Manual confirmation, rejection, splitting, unmatching, rematching, ignore/restore, remembered rules and waivers with reasons.
- Bank accounts, balances, consent expiry, last successful account/connection sync, errors and renewal links.
- Signed webhooks in both documented formats; durable event deduplication; scheduled backup ingestion and reconciliation with database leases.
- Dashboard, tenant ledgers, notifications, filtered transactions, cash-flow reports and Excel-compatible CSV export.
- Audit history, database constraints, atomic revision checks, single-owner HTTP-only-cookie authentication and CSRF checks.

## Financial policy

- All money is bounded integer cents in TypeScript and BIGINT cents in PostgreSQL. No binary floating-point currency calculations. Reporting ratios used only for chart heights are not financial calculations.
- Weekly obligations cover the chosen payment weekday through the next six days. First/last partial weeks are prorated by occupied days, inclusive of move-out. Daily rate weighting is rounded once to the nearest cent using integer arithmetic. This is an application accounting convention; align tenancy agreements and legal rent changes yourself.
- Rates effective within a future unpaid week use day weighting. Changes affecting already-issued past or prepaid weeks are blocked; original obligations are never edited in place. Unallocated future records are superseded and audited.
- Tenant profile inactive status controls visibility. An actual move-out date ends rent generation. Ended tenancies keep historical debts.
- Overdue requires grace + bank-lag allowance to have elapsed and a recent successful selected feed check. Stale/failed feeds show **Awaiting Bank Update**, with a separate bank warning. A recent API call is not a guarantee that the bank has published every payment.
- Incoming credit allocations cannot span unrelated tenants. A transaction or obligation cannot be over-allocated. Unmatching disables automatic reassignment until explicitly retried or manually matched.
- Aliases use normalized whole phrases, not arbitrary substring matches. Distinctive aliases are essential: do not use generic phrases such as RENT. Shared aliases cause review.
- Remaining funds from identified tenants are credits, never silently classed as rent. Eligible credits can apply to later generated rent; uncertain rent/bill combinations remain for review.
- A supplier alias plus one exact outstanding bill is required for automatic debit matching. Uncertain/partial supplier payments are reviewed manually.
- When a posted transaction changes, its old allocations are reversed, retained and audited; automatic matching is disabled pending review. Pending-to-posted transitions are normal.
- Bills split by a divider greater than selected tenant count leave the extra shares with the owner. Remainder cents go in selection order. This avoids inventing tenants or losing cents.
- Cash reports use bank `post_date`, falling back to `date`. Obligations use due dates. The net cash figure includes classified receipts, identified tenant credits and classified outgoings; unrelated/unclassified transactions are shown separately and excluded. A bill cohort's unreimbursed cash cost is separately labelled.

## Architecture and limitations

See [Architecture](docs/ARCHITECTURE.md), [Banking contract](docs/REDBARK.md), [Operations](docs/OPERATIONS.md), and [Security](docs/SECURITY.md).

The initial data layer loads the owner's complete ledger and commits normalized rows atomically using a revision check. This deliberately favours correctness and maintainability for one owner. It is not designed for institutional transaction volumes; paginate read models and replace full-ledger commits with narrower commands before scaling to large portfolios. Multiple properties are supported now; one selected bank account is assigned to one property to avoid ambiguous cross-property allocation.

Email/push transport is not enabled: internal notifications are durable and include a type/key/payload structure suitable for adding a delivery worker. CSV is an export only. No spreadsheets are needed to ingest bank data.

## Validation

`pnpm test` covers the requested acceptance scenario plus database constraints and security boundaries. API contract tests use documented fixtures and mocked HTTP responses, never pretend live banking. PostgreSQL tests execute the real migration in PGlite (PostgreSQL/WASM), including atomic allocation limits, immutable history, role permissions, replay uniqueness and revision conflicts. A credentialed live Redbark/Supabase smoke test remains a required activation step.
