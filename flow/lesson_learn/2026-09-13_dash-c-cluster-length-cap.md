# LSL: `unwrapShellDashC` `length <= 4` missed `bash -liec 'find …'`

## Context
OT-bash-c unwraps `bash -c` / `-lc` / `-ic` so the inner program is classified. The short-cluster branch required `a.length <= 4`. Valid `bash -liec 'find /home/bhd'` (login+interactive+errexit+command) returned null → classified as `bash` → no bash rule → default allow → home-wide find bypassed.

## Solutions
Any short cluster whose final option is `c` (`/^-[a-zA-Z]*c$/`) unwraps the next arg as payload. Recurse via `splitTopLevelSegments`.

## Gotchas
- Length caps on option clusters are arbitrary vs real bash (`-liec`, `-elc`, …).
- Combined with the compound-split P0: payload *and* trailing `&& find /` must both be evaluated.

## Ref
src/parser/unwrapShellDashC.ts
src/parser/splitTopLevelSegments.ts
