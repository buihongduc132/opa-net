# LSL: branch-target-allowlist is signals-gated — bare CLI from non-repo cwd is ALLOW by design

## Context
Verifier d2 probed `pi-opa-net eval "git checkout feature-x"` from a non-repo cwd, got ALLOW, read it as "required DENY unproven". The rule is conditional (PR #2): it fires only when `SignalCollector` supplies `signals.repo.is_main_worktree` etc., which requires eval inside a git repo (cwd or `-C`). No signals → fail-open default, same as other signals-gated rules. Non-existent branch `feature-x` also classifies `commit-ish`, not `branch`.

## Solutions
Prove DENY with a **real fixture repo** and an **existing non-allowed branch** (`tests/e2e/worktree-gating-e2e.test.ts` case (a) `git checkout feature-evil` → deny, `branch-target-allowlist`). Persist the audit JSONL (`branch-gate-deny.jsonl`). Document in `signals-gated-branch-rule.md` so the next verifier does not re-litigate the bare-CLI probe.

## Gotchas
- `git checkout -` (previous branch) was classified `detached` and skipped the allowlist — resolve `@{-1}` via `git rev-parse --abbrev-ref` when cwd is available.
- `--recurse-submodules` / `-l` as value-consuming flags ate the branch name.

## Ref
flow/findings/2026-09-13-dev-stage-deploy-proof/signals-gated-branch-rule.md
flow/findings/2026-09-13-dev-stage-deploy-proof/branch-gate-deny.jsonl
tests/e2e/worktree-gating-e2e.test.ts
src/parser/checkoutTarget.ts
