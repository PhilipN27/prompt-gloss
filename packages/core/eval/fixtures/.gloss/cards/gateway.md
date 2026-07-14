---
term: gateway
aliases:
  - api gateway
created: 2026-07-13T20:19:00.000Z
updated: 2026-07-13T20:19:00.000Z
scope: project
source:
  span: gateway
  message: the gateway rate-limits per tenant
---

The gateway is the Envoy edge proxy. It terminates TLS, does per-tenant rate
limiting, and routes to internal services. "Gateways" in plural still means this
one component in our docs.
