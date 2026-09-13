# LSL: eza `-L` presence is not a bound — N must be ≤ 2

## Context
Plan gotcha `eza-level-gate`: exempt only when `-L N` with N≤2. Implementation only checked *presence* of `-L`/`--level`. Probe `eza -T -L 99 /` → ALLOW (unbounded in practice). Verifier round-1 REJECT.

## Solutions
Parse numeric N from `-L N` / `-LN` / `--level=N` / `--level N` (set-returning helpers `eza_level_eq`/`attached`/`separated`). Bounded iff `max(N) ≤ 2`. `eza -T -L 99 /` and `eza -T --level=3 /` deny; `eza -T -L 2 /` allow.

## Gotchas
- OPA: function-arg `n := to_number(s)` → `rego_compile_error: arg n redeclared`. Comprehension `{n | helper(args, n)}` → `var n is unsafe`. Use **set-returning functions** (`helper(args) := {n | … n := to_number(s)}`) then `max(ns) <= 2`.
- `eza -T` with no `-L` stays deny (unbounded tree).

## Ref
policy/safety.rego (GROUP L eza_level_*)
tests/fixtures/shallow-heavy-scan.json (eza-level99-root, eza-level-eq3-root)
flow/plans/ban-shallow-heavy-scan.md
