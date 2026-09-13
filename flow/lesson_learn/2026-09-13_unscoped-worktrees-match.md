# LSL: unscoped `/.worktrees` regex allowed any `.worktrees` on disk

## Context
`is_worktrees_path` included `regex.match("/\\.worktrees(/|$)", p)`. Any path containing `/.worktrees` (another repo, `/tmp/evil/.worktrees`, …) read as the allowlisted worktree tree and skipped the home-wide / shallow-scan deny.

## Solutions
Drop the unscoped match. Keep only: relative `.worktrees` / `./.worktrees` / those prefixes with `/`, plus absolute under `eval_cwd/.worktrees`.

## Gotchas
- "Looks like our worktrees dir" is not "is our worktrees dir". Scope to eval cwd.

## Ref
policy/safety.rego (`is_worktrees_path`)
