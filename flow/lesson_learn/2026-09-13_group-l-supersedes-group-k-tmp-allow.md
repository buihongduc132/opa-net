# LSL: GROUP L LD1 supersedes GROUP K tmp-only allow (`find /tmp`)

## Context
BHD-202 expected `find /tmp -name completion.json` → ALLOW (tmp-only, no home root). GROUP L (`block-shallow-heavy-scan`, locked 2026-09-09 LD1) later banned ALL heavy scans on absolute paths at depth ≤ 2. `/tmp` is depth 1 → combined decision is DENY via GROUP L. Stale GROUP K test failed after GROUP L landed.

## Solutions
Update the GROUP K e2e: expect `deny`, `exitCode=2`, reason `block-shallow-heavy-scan`, and NOT `block-home-wide-find`. Document the supersession in CHANGELOG 0.7.0 and the fixture notes.

## Gotchas
- Two gates can both be "correct" for different locked decisions. When they overlap, the later lock wins and the older test must be rewritten, not the newer rule weakened.
- `find /tmp /home/bhd …` (home prefix present) still fires GROUP K; tmp-only fires GROUP L.

## Ref
tests/e2e/block-home-wide-find-grep.test.ts
tests/fixtures/shallow-heavy-scan.json
flow/plans/ban-shallow-heavy-scan.md
