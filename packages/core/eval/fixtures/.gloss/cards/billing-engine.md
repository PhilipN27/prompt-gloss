---
term: billing engine
aliases:
  - billing service
created: 2026-07-13T20:16:00.000Z
updated: 2026-07-13T20:16:00.000Z
scope: project
source:
  span: billing engine
  message: the billing engine keeps double-charging
---

The billing engine is the Go service under `services/billing`. It owns invoice
generation, proration, and the Stripe webhook handler. It is idempotent by
`(customer_id, period)` — never retry a charge without checking the ledger.
