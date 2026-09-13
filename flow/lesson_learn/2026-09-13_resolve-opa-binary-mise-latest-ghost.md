# LSL: `resolveOpaBinary` returned nonexistent `<mise>/latest/opa` on CI

## Context
CI verify failed 7 deny/unlock e2e tests (`Expected exit 2, received 0`). `src/config/Config.ts` `resolveOpaBinary`: if mise dir exists but has no semver folder, pick `'latest'` and return `<HOME>/.local/share/mise/installs/opa/latest/opa` **without existsSync**. GitHub runners have no mise opa → engine fail-open → every deny test allows. Main CI had been red since 2026-08-16 for this reason (masked locally because mise *is* installed).

## Solutions
Order: explicit > `PI_OPA_BINARY` > mise (existsSync-verified) > PATH `'opa'`. `setup-opa` in CI puts `opa` on PATH. Also add `setup-opa` to the **publish** job — `prepublishOnly` runs `bun test` and that job originally had no OPA.

## Gotchas
- Local green ≠ CI green when the binary resolver prefers a ghost path over PATH.
- `existsSync` needs a real `import { existsSync } from 'node:fs'` — this module had been type-only; a lazy `require` in `readdirSafe` does not export `existsSync` to the caller.

## Ref
src/config/Config.ts (`resolveOpaBinary`)
.github/workflows/ci.yml (verify + publish `setup-opa`)
