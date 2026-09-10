---
"zenvark": patch
"@zenvark/prom": patch
---

Build with TypeScript 7 and test with Vitest 5. The shared `@lokalise/tsconfig` preset is updated to 5.0.0, which sets `rootDir` explicitly for the new TypeScript 7 defaults. Emitted JavaScript and declaration files are unchanged in layout; no runtime behaviour changes.
