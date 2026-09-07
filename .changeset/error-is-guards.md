---
"zenvark": minor
---

Add a static `isInstance()` type guard to every error class (for example `CircuitOpenError.isInstance(err)`) and `ZenvarkError.isZenvarkError(err)` for matching any zenvark error. The guards check a shared `Symbol.for` brand plus the error `code`, so they keep working when the prototype chain cannot be trusted, such as with duplicate copies of zenvark in `node_modules` or errors crossing realms. `instanceof` keeps working for the single-copy case.

Error codes are now literal-typed, so `err.code === 'CIRCUIT_IS_OPEN'` narrows in a switch over `ZenvarkError`. Each class also exposes its code as a static property.
