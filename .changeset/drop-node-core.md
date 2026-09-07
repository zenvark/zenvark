---
"zenvark": major
---

Drop the `@lokalise/node-core` runtime dependency. All error classes now extend a local, exported `ZenvarkError` base class with `code`, `details`, and `cause` fields.

Breaking changes for consumers:

- The `errorCode` field on thrown errors is renamed to `code`.
- `instanceof InternalError` checks from `@lokalise/node-core` no longer match zenvark errors; use `instanceof ZenvarkError` or the concrete error classes instead.
