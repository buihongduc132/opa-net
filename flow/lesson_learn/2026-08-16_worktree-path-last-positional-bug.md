# LSL: worktree path signal took LAST positional instead of git grammar path

## Context
`git worktree add .worktrees/foo HEAD` was wrongly DENIED by worktree-path-allowlist.
Signal extracted "HEAD" (last positional) as target path; allowlisted path never evaluated.
Real git synopsis: `git worktree add <path> [<commit-ish>]` — path FIRST.
Old-style `git worktree add <commit-ish> <path>` also valid → ambiguity.

## Solutions
`src/signals/WorktreeSignals.ts`:
- add: 2 positionals → pick path-LIKE one (`contains '/'` or starts `.` `~`), else FIRST
- move: keep LAST (new-path is last)
- repair: FIRST (main path)
Regression tests: `tests/unit/signals/signals.test.ts` (path-first + old-style cases).
Verified both directions: `.worktrees/foo HEAD` → allow; `/tmp/evil HEAD` → deny.

## Gotchas
- Deployed pi-bash-guard runs OLD policy until pi-opa-net redeploy — source fix ≠ live fix immediately.
- Guard parses the WHOLE bash line: `| tail -1` / `&&` / `2>&1` tokens pollute args and can trigger wrong worktree-path denial. Keep guard-tested commands single and clean.

## Ref
../findings/2026-08-16-group-j-devops-cli-coverage/scout-recon.md
