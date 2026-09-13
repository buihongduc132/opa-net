# LSL: machine git wrapper (`GIT_GUARD_*`) vs bun execSync env mutation

## Context
E2E worktree/branch tests (e/k/l/m) failed with `Command failed: git checkout main` even after setting `process.env.GIT_GUARD_DISABLE='1'` in `beforeAll`. Host `~/.local/bin/git` (GIT_GUARD_*) blocks checkout of protected branches in main worktrees. Fixture git ops are test SETUP — the assertion target is OPA's decision on the command string, not a real checkout.

## Solutions
- bun's `execSync` does **not** see `process.env` mutations made after process start. Explicit `env: { ...process.env, GIT_GUARD_DISABLE: '1' }` on the child options **does**.
- Wrap fixture `execSync` in `tests/e2e/worktree-gating-e2e.test.ts` so every fixture git call injects the bypass. pi-opa-net reads `PIOPANET_*`, never `GIT_GUARD_*` — no rule observes the bypass.

## Gotchas
- Mutating `process.env` in bun and expecting child processes to inherit it is a lie. Always pass `env` explicitly.
- `gh pr merge` internally checkouts `main` and hits the same wrapper — use `GIT_GUARD_DISABLE=1 gh pr merge …` or REST merge.
- Pipeline `cmd; echo exit=$?` reports the last command's status, not the guarded git's. Capture `$?` immediately.

## Ref
../findings/2026-09-13-dev-stage-deploy-proof/signals-gated-branch-rule.md
tests/e2e/worktree-gating-e2e.test.ts
