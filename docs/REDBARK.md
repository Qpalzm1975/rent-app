# Redbark contract notes

Verified against the official documentation and OpenAPI schema on 2026-09-28 and **rechecked on 2026-10-19**: API v2 is still labelled **beta** and `2026-10-01.wattle` is still the only published release. The version string is sent exactly as documented, not inferred from the workstation date. A credentialed production call has not been possible in this environment.

## Implemented request contract

Base: `https://api.redbark.com/v2`. Every API operation sends `Authorization: Bearer <server secret>` and `Redbark-Version`. No API base URL is user-editable. Pagination links must remain on the exact API origin and v2 path, and fetch redirects are rejected, preventing credential forwarding to arbitrary hosts.

| Operation | Documented endpoint / behavior |
|---|---|
| List AU connections | `GET /connections?provider=fiskil&limit=100`; only Fiskil banking connections accepted |
| List accounts | `GET /accounts?limit=100`; filter to Fiskil, banking, AUD |
| Balance | `GET /accounts/{id}/balance`; money amount is integer cents, observed_at/freshness retained |
| Transactions | `GET /transactions?account=...&from=...&to=...&include_pending=true&limit=100`; account is required |
| More pages | Follow `next_page_url`; opaque page token contains original filters |
| Connect | `POST /link_sessions` with provider `fiskil` and fixed configured return URL |
| Renew | `POST /connections/{id}/reauthorize` with return URL (same connection and accounts; emits `connection.refreshed`) |
| Disconnect | `DELETE /connections/{id}` with an idempotency key; withdraws consent at the provider. Local history is kept |
| Setup helper | `POST /destinations`, `POST /event_destinations`, `POST /syncs` using a separate setup key |

Transaction fields used are `id`, `account`, `status`, `date`, `post_date`, `description`, `reference`, `extended_description`, `merchant_name`, `amount.amount`, `amount.currency`, `direction` and `livemode`. Zod validates the required shape and integer amount. Unknown fields are ignored; missing/changed required financial fields stop ingestion. Pending transactions never produce final allocations.

Behaviours the integration relies on (from Redbark's docs, rechecked 2026-10-19):

- **Pending IDs are not stable.** A bank may give the settled transaction a new ID with no reliable link to the pending one, and amount or text may change. Posted IDs are the deduplication key. After a fully fetched window, a stored pending row the provider no longer returns is marked `superseded` (kept, never counted); it is restored if it reappears.
- **A transaction's currency can differ from its account's.** The ledger is AUD-only, so non-AUD rows are left out (and counted in the job response) instead of failing the whole sync.
- **Omitting `from` returns only 30 days**, bare dates are inclusive in Redbark's time zone, and a 5,000-row ceiling sets `X-Redbark-Truncated` (the client bisects the window). Each sweep runs to one day past the property's today.
- **Balances are informational.** With Fiskil, a live balance read is limited to one per account per 15 minutes (`429 balance_refresh_limited`). Retryable balance errors keep the previous observation and do not mark the feed failed; authorisation errors still do.
- **Errors** use stable codes. `upstream_auth_failed` means renew consent; rate-limit, `provider_wait` and upstream-unavailable codes are retried on the next run; owner-facing messages say which.
- **Scopes.** `data:read` is the only banking-data scope (there is no banking write scope). The runtime key also needs `connections:write` (includes read) for consent links, renewal and disconnect. The setup key additionally needs `destinations:write`, `syncs:write` and `events:write`, and should be revoked after setup.

Redbark’s pass-through reads can use a short-lived provider gateway cache. The app distinguishes last successful API reconciliation, provider last-refreshed time and balance observation/freshness. It does not claim instant publication by the bank. The user's bank remains responsible for posting latency.

## Two webhook formats

- Full transaction destination: `X-Redbark-Signature: sha256=<hex>`, `X-Redbark-Timestamp`, `X-Redbark-Delivery-Id`. HMAC-SHA256 over `timestamp.raw_body`. Stable event `id` deduplicates retries.
- Thin v2 lifecycle event: `Redbark-Signature: t=<timestamp>,v1=<hex>[,v1=<rotated-hex>]`, `Redbark-Event-Id`, `Redbark-Delivery-Id`. The same timestamp/body HMAC rule applies. Accept any valid v1 value with a configured current/previous event secret.

Both reject timestamps more than 300 seconds in either direction. The event secret and transaction-destination secret are deliberately separate. `REDBARK_*_SECRET_PREVIOUS` supports a controlled rotation period (v2 event secrets: the old one stays valid for 24 hours after rotation).

Delivery semantics differ, so responses differ: the **transaction destination** makes three quick attempts and is **disabled after one failed delivery**, while **v2 events** are retried for three days (disabled after three days of continuous failure). If recording a verified event fails, the app returns 202 for a transaction delivery (it only means “sync now”, which the scheduled job covers) and 503 for a v2 event so Redbark retries.

`transactions.synced` fires only when a configured Redbark sync writes rows to a destination; an API-only feed gets no event for new bank data. The scheduled REST reconciliation is therefore the primary path and webhooks only make it sooner. `destination.disabled`, `event_destination.disabled` and `sync.attention` raise owner notices, which later successful deliveries resolve. Lifecycle-only events trigger the normal incremental window; `transactions.synced` and new or renewed connections trigger a full history sweep.

An event signals a full REST reconciliation rather than inserting unverified/ differently-namespaced webhook transaction fields. That avoids deduplication errors across provider surfaces and updates consent/account health. Verified events are recorded before returning 202 whenever the database is reachable (see the failure policy above); missed continuations are recovered by cron.

## Setup and supported use

This is for the account holder's own data. Redbark's help centre allows connecting your own personal or business accounts for your own internal use, and excludes accessing data on behalf of others, offering hosted consent to third parties or exposing the API in a product for others. Tenants paying into your account does not make them account holders. Do not turn the project into a customer-bank-data product (or share it with a property manager) without revisiting Redbark's terms and the relevant CDR arrangement. Redbark is a CDR Representative of Fiskil Pty Ltd (ADRBNK000246); consent lasts at most 12 months and Redbark emails 90 days before expiry. Redbark lists about 85 Australian institutions through Fiskil, including the major banks; confirm your own bank and account type in the hosted flow. No bank username or password is collected. Link/renewal URLs are accepted only from HTTPS `app.redbark.com`.

References: [v2 overview](https://redbark.com/docs/api-reference/v2/overview), [banking](https://redbark.com/docs/api-reference/v2/banking), [connect](https://redbark.com/docs/api-reference/v2/connect), [events](https://redbark.com/docs/api-reference/v2/events), [errors](https://redbark.com/docs/api-reference/v2/errors), [transaction webhooks](https://redbark.com/docs/api-reference/webhooks), [pending transactions](https://redbark.com/docs/help-center/pending-transactions), [consent and data](https://redbark.com/docs/compliance/consent-and-data), [business and customer data](https://redbark.com/docs/help-center/business-and-customer-data), [supported banks](https://redbark.com/connections), [OpenAPI](https://api.redbark.com/v2/openapi.json).
