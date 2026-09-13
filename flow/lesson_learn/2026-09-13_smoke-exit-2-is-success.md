# LSL: smoke script `eval "git stash pop"` exits 2 (deny) — CI bash `-e` treats it as failure

## Context
After OPA-on-PATH fix, CI tests went 479 pass / 0 fail, then the `smoke` step failed. Smoke is `bun run bin/pi-opa-net.js eval "git stash pop" --json`. Correct behavior is **deny, exit 2**. Workflow `shell: bash -e` treats any non-zero as failure. The smoke was proving the gate works and CI called that a fail.

## Solutions
`package.json` `smoke` script: capture `ec`, succeed iff `ec == 2`, else fail with the actual code. Do not swallow stdout on the assertion path if you need the JSON for humans — print a one-line `smoke OK (… exit 2)`.

## Gotchas
- A "smoke that the guard blocks X" cannot use the blocked command's exit code as the job's success code without an explicit assert.
- Same class as any Claude-Code-protocol tool: 0=allow, 2=deny. CI must know the protocol.

## Ref
package.json (`scripts.smoke`)
.github/workflows/ci.yml (`bun run smoke`)
