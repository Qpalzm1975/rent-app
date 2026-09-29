# Redbark contract notes

Verified against the official documentation and OpenAPI schema on 2026-09-28. API v2 is explicitly **beta**. The official first version header is `2026-10-01.wattle`; the date-looking version string is sent exactly as documented, not inferred from the workstation date. A credentialed production call has not been possible in this environment.

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
| Renew | `POST /connections/{id}/reauthorize` with return URL |
| Setup helper | `POST /destinations`, `POST /event_destinations`, `POST /syncs` using a separate setup key |

Transaction fields used are `id`, `account`, `status`, `date`, `post_date`, `description`, `reference`, `extended_description`, `merchant_name`, `amount.amount`, `amount.currency`, `direction` and `livemode`. Zod validates the required shape and integer amount. Unknown fields are ignored; missing/changed required financial fields stop ingestion. Pending transactions never produce final allocations.

Redbark’s pass-through reads can use a short-lived provider gateway cache. The app distinguishes last successful API reconciliation, provider last-refreshed time and balance observation/freshness. It does not claim instant publication by the bank. The user's bank remains responsible for posting latency.

## Two webhook formats

- Full transaction destination: `X-Redbark-Signature: sha256=<hex>`, `X-Redbark-Timestamp`, `X-Redbark-Delivery-Id`. HMAC-SHA256 over `timestamp.raw_body`. Stable event `id` deduplicates retries.
- Thin v2 lifecycle event: `Redbark-Signature: t=<timestamp>,v1=<hex>[,v1=<rotated-hex>]`, `Redbark-Event-Id`, `Redbark-Delivery-Id`. The same timestamp/body HMAC rule applies. Accept any valid v1 value with a configured current/previous event secret.

Both reject timestamps more than 300 seconds in either direction. The event secret and transaction-destination secret are deliberately separate. `REDBARK_*_SECRET_PREVIOUS` supports a controlled rotation period.

An event signals a full REST reconciliation rather than inserting unverified/ differently-namespaced webhook transaction fields. That avoids deduplication errors across provider surfaces and updates consent/account health. Verified events are persisted before returning 202; missed continuations are recovered by cron.

## Setup and supported use

This is for the account holder's own data. Do not turn the project into a customer-bank-data product without revisiting Redbark's terms and the relevant CDR arrangement. No bank username or password is collected. Link/renewal URLs are accepted only from HTTPS `app.redbark.com`.

References: [v2 overview](https://redbark.com/docs/api-reference/v2/overview), [banking](https://redbark.com/docs/api-reference/v2/banking), [connect](https://redbark.com/docs/api-reference/v2/connect), [events](https://redbark.com/docs/api-reference/v2/events), [transaction webhooks](https://redbark.com/docs/api-reference/webhooks), [OpenAPI](https://api.redbark.com/v2/openapi.json).
