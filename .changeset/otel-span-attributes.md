---
"@zenvark/otel": minor
---

Add an `attributes` option to `ZenvarkOtel`, setting extra attributes on every span, either fixed or resolved from the breaker or semaphore id.

Zenvark knows what a breaker is called, not what it protects, so `zenvark.call` and the other client spans carried no peer of their own. Applications can now describe the dependency, such as the `server.address` that OpenTelemetry's semantic conventions expect on a client span, which lets a backend attribute calls to the dependency they reach across every breaker regardless of the protocol used. Zenvark's own `zenvark.*` attributes take precedence.
