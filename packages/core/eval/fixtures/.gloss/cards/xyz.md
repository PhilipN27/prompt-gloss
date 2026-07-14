---
term: xyz
aliases:
  - metrics panel
  - xyz dashboard
created: 2026-07-13T20:15:00.000Z
updated: 2026-07-13T20:15:00.000Z
scope: project
source:
  span: xyz
  message: I want a dashboard that helps me build xyz
---

xyz is our internal name for the customer-facing metrics panel. It reads from
the `analytics_rollup` table, must stay under 200ms p95, and is owned by the
growth team. Do not add new queries without an index review.
