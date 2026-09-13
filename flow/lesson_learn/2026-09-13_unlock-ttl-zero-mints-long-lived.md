# LSL: `ttlSec` 0/negative/NaN silently minted a long-lived unlock key

## Context
`mintUnlockKey`: `if (opts.ttlSec !== undefined && opts.ttlSec > 0)` else fall through to `ll_<mac>`. `ttlSec=0` or `-5` minted a **permanent** key. Fractional/NaN/Infinity produced TTL keys the verifier cannot parse.

## Solutions
If `ttlSec` is provided at all, require finite positive integer; otherwise throw. Omit `ttlSec` for long-lived. Applied in root + hermes + zcode copies. Tests: zero/negative/fractional/NaN/Infinity all throw `/invalid ttlSec/`.

## Gotchas
- Three copies of `unlock-key.ts` (root, hermes-opa-net, zcode-opa-net). Fixing one leaves the others minting god-keys.
- `> 0` is not a validator; it is a silent mode switch.

## Ref
src/cli/unlock-key.ts
packages/hermes-opa-net/src/cli/unlock-key.ts
packages/zcode-opa-net/src/cli/unlock-key.ts
tests/unit/cli/unlock-key-subcommand.test.ts
