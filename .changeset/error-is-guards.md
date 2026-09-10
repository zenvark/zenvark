---
"zenvark": minor
---

Add a static `isInstance()` type guard to every error class (for example `CircuitOpenError.isInstance(err)`) and `ZenvarkError.isZenvarkError(err)` for matching any zenvark error. The guards check a shared `Symbol.for` brand plus the error `code`, so they keep working when the prototype chain cannot be trusted, such as with duplicate copies of zenvark in `node_modules` or errors crossing realms. `instanceof` keeps working for the single-copy case.

Error codes are literal-typed per class and exposed as a static property, for example `CircuitOpenError.code`. After an `isInstance()` check, `err.code` and `err.details` are typed to that class.
