---
term: analytics_rollup
aliases:
  - rollup table
created: 2026-07-13T20:17:00.000Z
updated: 2026-07-13T20:17:00.000Z
scope: project
source:
  span: analytics_rollup
  message: the analytics_rollup job runs hourly
---

`analytics_rollup` is the hourly-materialized Postgres table backing the metrics
panel. Partitioned by day; queries must include a `day` predicate or they will
scan the whole table.
