# Production deployment

## What you need to supply

| Account / credential | Why it is needed | Where it goes |
|---|---|---|
| Supabase project, preferably Sydney | Durable PostgreSQL ledger | Apply `supabase/migrations/202609280001_initial_ledger.sql` in its SQL editor |
| Supabase Project URL | HTTPS server database endpoint | `SUPABASE_URL` on Vercel |
| Supabase service-role API key | Server-only database RPC access | `SUPABASE_SERVICE_ROLE_KEY` on Vercel; never in browser code |
| Vercel project | Next.js HTTPS host reachable by Redbark | Import the source using the included `vercel.json` |
| A unique 16+ character owner password | Single-user authentication | Run `node scripts/password-hash.mjs` locally; put only the resulting full hash in `OWNER_PASSWORD_HASH` |
| Two independent random secrets | Session signing and job authentication | Generate each with `openssl rand -hex 32`; set `SESSION_SECRET` and `CRON_SECRET` |
| Redbark account with API/webhook access | Australian CDR data through Fiskil | Create a Developer API key under Settings → API & MCP |
| Redbark runtime API key | Read data and initiate hosted bank consent | `REDBARK_API_KEY`; scopes `data:read`, `connections:write` |
| Bank CDR consent | Authorise your own selected bank accounts | Complete the hosted consent flow yourself from Settings → Bank connection |
| Transaction webhook signing secret | Authenticate Redbark deliveries | `REDBARK_WEBHOOK_SECRET` |
| Optional v2 event signing secret | Consent lifecycle events | `REDBARK_EVENT_SECRET` |

`connections:write` permits managing the provider connection/consent; it does not initiate bank payments. Rentledger has no payment initiation, scraping or banking-password fields. Bank compatibility is discovered from Redbark's Fiskil flow; your particular bank has not been selected or verified yet.

## Deploy in order

1. Download the source archive and extract it. Create a **private** Git repository that you control and push the source, excluding `.env.local`. Keep the supplied `.gitignore`.
2. Install Node 22.13+ and pnpm (the lockfile records the tested pnpm version). Run `pnpm install --frozen-lockfile`.
3. Create the Supabase project. In SQL Editor run the **entire** initial migration. It creates 21 relational/support tables, foreign keys, indexes, immutable-history triggers, RLS and transactional RPCs. If using the Supabase CLI, run `supabase init` if necessary, `supabase link --project-ref YOUR_REF`, then `supabase db push`.
4. Create a Redbark API key. Pin `REDBARK_API_VERSION=2026-10-01.wattle`, as specified in the official v2 docs read during implementation. v2 is labelled beta by Redbark. If this version is rejected on your account, stop and check the current official contract; do not remove version validation or guess replacement fields.
5. Generate the password hash and two secrets. Password input is hidden when run interactively. Copy `.env.example` to `.env.local` for local development; use `APP_ORIGIN=http://localhost:3000` only locally. Run `pnpm dev:next`.
6. Import the repository into Vercel as Next.js. Use `pnpm build:vercel` as the build command (already in `vercel.json`). The `pnpm build` script is for the private Sites preview, not Vercel. Keep `regions: ["syd1"]` unless you intentionally choose another region.
7. In Vercel Project Settings → Environment Variables, add all runtime values from `.env.example`. Use `AUTH_MODE=password`. `APP_ORIGIN` must exactly match the final HTTPS origin, without a path/trailing slash. Add credentials only for environments you trust; a preview deployment must not silently inherit production banking credentials.
8. Redeploy. Sign in, add the property, rooms, tenants, rent rates and aliases. Configure matching and grace periods. Connect your bank through the hosted CDR flow. Find accounts, select the rental account and assign its property. The API key never goes to the browser.
9. Click Sync now **once for activation verification**. Confirm real account names, masked identifiers, a balance observation and posted transactions. No daily manual sync is required.
10. Configure the webhook and recurring job below, then finish the setup wizard.

## Webhooks

Production URL: `https://YOUR-APP-DOMAIN/api/webhooks/redbark`.

Option A, provider dashboard: create a **Webhook destination**, copy its signing secret to `REDBARK_WEBHOOK_SECRET`, then create an enabled **transaction sync** from the rental account to that destination. Set its history start date consistently with the app. Pending transactions may be received but are never reconciled; exclude them for the main sync if choosing manually. Trigger the first run after setting the secret and redeploying.

Option B, API setup helper: create a temporary setup key with `data:read`, `connections:read`, `destinations:write`, `syncs:write`, `events:write`. Load it as `REDBARK_SETUP_API_KEY` in your local shell, alongside `APP_ORIGIN`, without committing values. Run `node scripts/configure-redbark.mjs`. It lists accounts and lets you choose numbers; then creates a webhook destination, lifecycle event destination and transaction sync. Its one-time secrets are saved to `.env.redbark.local` with owner-only file permissions. Copy them into your hosting environment and redeploy. Then run the sync in Redbark and verify HTTP 202. The broader setup key is not the runtime key; revoke it after setup.

The helper intentionally refuses to overwrite a pre-existing `.env.redbark.local`. Before retrying a partially completed setup, inspect existing destinations/syncs in Redbark and preserve any one-time secret already created. Do not blindly create duplicate subscriptions.

The handler checks the HMAC against **raw bytes**, validates a 5-minute timestamp window, supports both documented header formats, checks event IDs and atomically deduplicates events. It persists the event before acknowledging, then starts a background sync. Jobs drain unprocessed events if that continuation is interrupted. A webhook never forwards an arbitrary callback URL or trusts a browser-supplied bank record.

**Endpoint reachability:** use your actual production Vercel URL. Vercel Preview Protection or a private Sites login gate will block provider requests before the app sees them. The application itself protects all financial screens and owner routes; the webhook is intentionally internet-reachable and accepts only verified signatures. The cron route independently requires its bearer secret.

## Scheduled reconciliation

Recommended: Supabase Cron + pg_net and Vault.

1. In Supabase Vault create `rentledger_origin` with your HTTPS origin and `rentledger_cron_secret` with the exact Vercel `CRON_SECRET`.
2. Run `supabase/schedule.sql`. It enables pg_cron/pg_net and installs/replaces the named job `rentledger-reconcile` every 30 minutes.
3. Inspect `cron.job_run_details` and `net._http_response`. Successful dispatch alone is not enough; the HTTP request must return a success status and the app must show a new successful bank sync timestamp.

Alternative: on a Vercel plan supporting a 30-minute cron schedule, use `vercel.cron.example.json` as `vercel.json`, preserving the build/functions/region fields. Vercel sends `CRON_SECRET` as the Bearer token. Check current plan scheduling limits before choosing it. Use one primary scheduler; a database lease makes accidental overlapping runs safe.

Each run generates current/upcoming rent, obtains connections/accounts, fetches selected accounts in bounded windows, ingests/deduplicates posted/pending records, reconciles deterministic matches, records health and updates notifications. The normal overlap is 35 days; one daily full-history sweep and webhook-triggered full sweep catches older mutations. Historical local data is not purged when it falls outside the bank's current response window.

## Required live activation checks

- Log out and verify `/api/state`, `/api/action`, account listing, sync and exports require authentication.
- Submit an unsigned webhook and verify 401. Run a genuine Redbark test/sync and verify 202.
- Confirm the selected account is the one used for rent, and its balance/transactions agree with the provider.
- Confirm one known tenant alias correctly matches a posted receipt; check the reasons and allocation.
- Check there are no duplicate transactions after a repeated sync.
- Confirm the scheduled job runs without visiting the app.
- Check expiry/renewal controls and notifications.
- Take a database backup, test restore in a separate Supabase project, and keep secrets separate from source and backups.

These are human activation checks, not unfinished application code. They cannot be performed against your private accounts until you create the services and grant consent.

## Sources verified for this build (28 September 2026)

- [Redbark API v2 overview](https://redbark.com/docs/api-reference/v2/overview)
- [Redbark live OpenAPI document](https://api.redbark.com/v2/openapi.json)
- [Banking resources](https://redbark.com/docs/api-reference/v2/banking)
- [Hosted connection sessions](https://redbark.com/docs/api-reference/v2/connect)
- [Signed v2 events](https://redbark.com/docs/api-reference/v2/events)
- [Transaction webhook payload/signatures](https://redbark.com/docs/api-reference/webhooks)
- [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Vercel cron jobs](https://vercel.com/docs/cron-jobs)
