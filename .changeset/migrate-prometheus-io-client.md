---
"@zenvark/prom": major
---

Migrate `@zenvark/prom` from `prom-client` to `@prometheus-io/client`, the package's new official home under the Prometheus org. Consumers must replace their `prom-client` dependency with `@prometheus-io/client` (same API surface — `Registry`, `Counter`, `Gauge`, `Histogram` — so no code changes are required beyond swapping the package).
