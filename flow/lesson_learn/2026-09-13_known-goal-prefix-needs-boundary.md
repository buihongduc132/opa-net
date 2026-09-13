# LSL: known-goal prefix without path boundary allowed `~/.pi/goals-evil` and `../.ssh`

## Context
`is_known_goal_dir` used `startswith(p, "~/.pi/goals")` and unbounded regexes. Sibling `~/.pi/goals-evil` and `$HOME/.pi/goals-evil` matched. `find_raw_known_goal` had the same unbounded regex, so even after the args-side fix the raw fallback still suppressed deny. `~/.pi/goals/../../.ssh` also matched the prefix then traversed out.

## Solutions
Every spelling requires `/` or end-of-string. Split exact (`p == "~/.pi/goals"`) vs child (`startswith(p, "~/.pi/goals/")`). Raw regexes get `(/|$)`. Wrap with `has_dotdot_segment` — any `..` segment rejects the goal-dir exemption.

## Gotchas
- Fixing the args-side predicate is not enough if a raw-token fallback uses the old unbounded pattern (`find_raw_known_goal`).
- Prefix allowlists without a boundary are sibling-inclusive by construction.

## Ref
policy/safety.rego (`known_goal_prefix`, `is_known_goal_dir`, `find_raw_known_goal`, `has_dotdot_segment`)
