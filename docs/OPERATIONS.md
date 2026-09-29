# Operations and recovery

## Normal use

The scheduler runs every 30 minutes. A verified webhook also starts reconciliation. Rent obligations are generated for current and upcoming weeks, and up to 14 calendar days ahead. Strong matches require no owner action. Visit the dashboard for overdue balances and review requests; the optional Sync now control is for verification/troubleshooting, not daily operation.

## Recovery checklist

| Symptom | What to inspect / do |
|---|---|
| Login unavailable | Confirm database migration, SUPABASE_URL/service key, OWNER_PASSWORD_HASH and SESSION_SECRET. Ten failed attempts lock the owner login for 15 minutes. |
| Can't save / revision conflict | Retry; the server automatically retries genuine concurrent commits. Inspect migrations if persistent. |
| Redbark 401 | Expired/revoked runtime API key; rotate it in server secrets. |
| Redbark 403 | Missing data/connection scope or unavailable API plan. |
| Redbark 400 / version error | Check the pinned version against current official docs; do not guess response shapes. |
| Consent expired / invalidated | Settings → Bank connection → Renew consent; complete bank authorisation yourself. |
| Connected but no transactions | Confirm account Track switch, property assignment, transaction history window, bank publication and successful last sync. |
| Old balances | Check observed_at/freshness; an API success does not make a stale provider observation fresh. |
| Awaiting Bank Update | Grace/settlement window or stale/failed feed prevents a new overdue assertion. Check feed health first. |
| Needs Review | Open the transaction, confirm tenant/obligation(s), enter exact split and reason. Save a distinctive reference rule if useful. |
| Incorrect automatic match | Unmatch it with a reason. Automatic reassignment is disabled. Fix aliases/rules, then rematch manually or Retry rules. |
| Changed posted transaction | The old allocations were reversed. Review the new bank amount/text/direction and manually confirm. Old allocations and change metadata remain auditable. |
| Webhook 401 | Check raw-body signature format, correct destination/event secret, deployment environment and server clock. |
| Webhook timeout / no 202 | Check public production endpoint reachability and database access. Provider retries; cron continues as backup. |
| Scheduler appears successful but feed stale | Inspect both cron.job_run_details and net._http_response. A job can enqueue an HTTP call while the call itself fails. |
| Sync time budget reached | Imported pages are saved, but the account is not marked successfully synced. Narrow history or contact bank/provider if it repeats; personal rental accounts should not reach this scale. |

## Notifications

Notification keys suppress repeated active notices. Rent/bill overdue, uncertain matches, connection failure, consent renewal and changed posted transactions are durable internal records. Resolving the underlying issue resolves the notice. Marking read is not a financial action and does not resolve an outstanding debt. Future email/push delivery should consume these records through a separate delivery table/worker, with its own consent and retry policy; never send notifications directly from matching code.

## Backups

Enable the backup tier appropriate to the value of your financial records; check your current Supabase plan’s backup/point-in-time recovery support. Keep a scheduled encrypted logical dump outside the project, ideally in a separate account. Include all public ledger tables and routines. Back up deployment secrets separately in a password manager; never include secrets in the source repository.

At least quarterly, restore a backup to a separate Supabase project and validate row counts, allocation totals, revision and immutable-history behavior. Keep the restored app's Redbark/job secrets unset during validation so a test restore cannot start a competing live ingestion job.

CSV exports are allocation-based accounting reports, not database backups. They omit full audit, consent, rules and unallocated transaction history. Full database backups are required for recovery.

## Rotations and maintenance

- Runtime API key: create replacement scoped key, update Vercel secret and redeploy, verify one successful sync, revoke old key.
- Webhook secret: set the old value as *_SECRET_PREVIOUS and new value as current. After the provider rotation interval and verified deliveries, remove the previous secret.
- Session secret: changing it invalidates all owner sessions. Reauthenticate afterward.
- Cron secret: update both Vercel and Supabase Vault before checking the next run.
- Domain: update APP_ORIGIN, Redbark webhook destination URL, event destination URL and Vault rentledger_origin together.
- Database migrations: back up first, apply append-only follow-up migrations and run the financial/SQL tests against a separate project. Do not re-run the initial schema over an existing installation.

The app retains historic financial records even after tenant departure, account deselection or consent expiry. Any future erasure/retention feature should use an explicit, authenticated export-and-delete workflow rather than silently deleting ledger history.
