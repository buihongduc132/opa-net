# LSL: A4 `runSelfCheck` macos flake — bun module cache keeps `hookRegistered=true`

## Context
CI macos: `runSelfCheck returns { ok: false } when hook not registered` got `{ ok: true }`. `src/pi/runtime-self-check.ts` holds module-level `hookRegistered`. A prior test in the same file (or parallel file sharing the module) called `markHookRegistered()`. Dynamic `import()` does not reset bun's module cache. Linux often didn't hit the order; macos did.

## Solutions
Export `__resetHookRegistrationForTest()` and call it at the start of the not-registered test. Do not rely on re-import for fresh module state in bun.

## Gotchas
- bun test file isolation ≠ module isolation. Shared `import.meta` modules leak flags across `it()`s.
- The passing test "after extension loaded" must run *after* the reset test, or reset again between them.

## Ref
src/pi/runtime-self-check.ts
tests/pi/runtime-self-check.test.ts
