# Architecture

## Layers

- `app/`: Next.js App Router pages and protected JSON routes. Routes only authenticate, validate transport and invoke the application layer.
- `components/rentledger/`: responsive owner interface, dialogs, tenant ledger, bank setup and reports. Money formatting and selectors use the shared engine.
- `lib/engine/`: framework-independent financial types, integer-cent arithmetic, calendar handling, obligation generation, allocation, deterministic matching, reporting and commands. It has no LLM dependency.
- `lib/bank/`: documented Redbark client, runtime response validation, raw-body signature verification and idempotent ingestion logic.
- `lib/server/`: server-only configuration, owner/session auth, strongly typed PostgreSQL repository and sync orchestration. Secrets are referenced only here or in server routes.
- `supabase/`: production migration plus the explicit scheduler installation script.
- `tests/`: the financial acceptance suite, provider contract/signature tests and real PostgreSQL migration/invariant tests via PGlite.

## Relational model

`app_user` owns all records. `property` has many `room`s. `tenant` is a person; `tenancy` associates a person with a room and dated occupancy. `rent_rate_history` records effective weekly rates. `rent_obligation` snapshots a particular rental week and the rates used.

`bill` is the outgoing supplier obligation; `bill_share` is an incoming tenant obligation. A bill may retain an owner share. Waived tenant shares remain historical but no longer count as recoverable.

`bank_connection` holds the provider reference, health and consent data; credentials are environment secrets. `bank_account` holds masked identifiers, balance observations, selected status and its property. `bank_transaction` stores the stable provider ID, account, signed direction, magnitude, posting date, relevant reference/counterparty text and current matching metadata. The unique key is owner + account + provider ID.

`transaction_allocation` links credits to rent or bill shares and debits to bills/expense categories. All allocations are positive integer cents. Unmatching marks previous allocations inactive and records a reason/timestamp. Replacements create new allocation IDs. `tenant_transaction_alias` and `matching_rule` identify people deterministically. `notification` and `audit_log` support owner review; `webhook_event` is a durable deduplication queue. `job_lock` and `login_attempt` are operational support tables.

## Atomic persistence

The repository loads a typed `State` via `ledger_snapshot`, applies a pure command, then invokes `ledger_commit(expected_revision, state)`.

The commit acquires an owner advisory lock, verifies the expected revision, upserts normalized relational rows and validates all allocations/bill sums within **one PostgreSQL transaction**. Foreign keys are deferred until the commit. Financial-history triggers disallow changes to immutable amounts/rate snapshots/target IDs. All previous rows are retained: no application command deletes historical financial records. A stale writer gets SQLSTATE 40001 and the server reloads/recomputes the command, up to four attempts.

This makes cross-request financial races safe without relying on in-memory locks. A process crash before commit leaves no partial allocation. A retry after commit does not duplicate bank transactions or generated rent. It is an intentional personal-scale implementation: it reads a full owner snapshot instead of a high-volume event-sourced system. Service-role RPCs are only called from authenticated server code or verified job/webhook entry points. Every table has RLS enabled and grants are denied to anon/authenticated browser roles.

## Matching policy

1. Require a posted transaction on a selected property account with remaining value.
2. For credits, find tenant identities using active whole-phrase aliases, explicit rules or a repeated exact reference previously confirmed manually twice. Amount and date cannot establish identity.
3. More than one identity means review. One identity with conflicting property means review.
4. Consider outstanding obligations before the early-payment cutoff. Old debts remain eligible for late payments; oldest is the default within an unambiguous category.
5. An exact combined outstanding total can cover rent and bills. Specific rent/bill references narrow the category. Competing equal amounts or uncertain partial mixed debt is reviewed.
6. Exact contiguous multiweek rent prepayments can cover generated future weeks. Surplus stays tenant credit; later eligible debt may consume it.
7. For debits, require a supplier alias plus a single exact outstanding bill amount in the date window.
8. Persist allocation reasons, confidence and source. Manual unmatch/reject disables automatic matching until retried; optional remembered references create editable rules.

Confidence is informational, not a probability. `97` reflects all required deterministic signals passing; it is not an ML estimate. Counterparty names may be absent or unreliable, so missing provider data never becomes assumed identity.

## Automation lifecycle

The scheduled job and webhook continuation share a 300-second leased lock. The worker has a 220-second ingestion budget and records failures rather than marking a partial fetch successful. Transaction windows are at most 30 calendar days. Responses are token paginated; a truncated provider range is bisected to avoid silent omission. New/changed rows are committed incrementally, but the account feed watermark advances only after its complete range and balance are retrieved.

Webhook events are committed before HTTP acknowledgement. Delivery retries see the same durable provider event ID. The background continuation performs a REST reconciliation; it deliberately does not combine the old webhook transaction ID format with v2 IDs. Cron retries unprocessed events and periodically re-reads transaction history. Bank-side consent errors remain visible, and stored history stays available.

## Time and reports

Property time defaults to `Australia/Perth` and is configurable. Rental/bill due dates use date-only PostgreSQL fields. Provider and audit moments use `timestamptz`. Calendar arithmetic uses date strings with UTC noon, not 24-hour local-time jumps, avoiding daylight-saving errors.

Cash report filters apply to posting dates. Rows are allocations, so a $330 transfer split into $250 rent and $80 reimbursement appears once in each category, with a combined cash effect of $330. Unallocated identified tenant funds are credits; unclassified amounts are excluded with a visible warning. Bill-cohort unreimbursed cost is not confused with date-range cash flow. Australian financial years run 1 July to 30 June.
