# LSL: quote-aware compound split that *rejoins tokens* drops `$HOME` and `/*` deny signals

## Context
Cubic P0: `bash -c 'x' && find /` evaluated only the `-c` payload and skipped the trailing command. Naive `;` split also cut through quoted `bash -c 'echo; find'`. First rewrite used `shell-quote` tokenize → split on control ops → **rejoin strings**. That dropped:
- `$HOME` → empty string token → rejoined `rm -rf` / `find` with no path → raw-token deny never fired
- `/*` → `{op:'glob'}` object → dropped → `rm -rf /*` became `rm -rf`
8 tests failed (`rm -rf $HOME`, `rm -rf /*`, `du -sh $HOME`, `find $HOME`).

## Solutions
1. Single-segment path: parse the **original raw**, never the rejoined segment.
2. Multi-segment: `splitTopLevelSegments` is a quote-aware **raw scanner** (not token rejoin). Control ops (`;` `&&` `||` `|` `&`) outside quotes are boundaries; `$HOME`/`/*` stay in the segment text. `bash -c` payloads recursively split; trailing commands after `&&` kept.

## Gotchas
- `shell-quote` expands `$HOME` to `""` and `/*` to a glob object. Any pipeline that round-trips through it loses the exact bytes the rego raw-token rules match.
- Redirects (`>`, `2>&1`) are NOT segment boundaries.
- `&` is a control op only when not part of a redirect (`2>&1`, `&>file`).

## Ref
src/parser/splitTopLevelSegments.ts
src/cli/run.ts (`evaluatePossiblyCompound`)
tests/unit/parser/splitTopLevelSegments.test.ts
