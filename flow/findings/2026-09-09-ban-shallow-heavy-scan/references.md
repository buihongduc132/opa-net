# References

> Sources consulted during this explore session.

## Source files
- `policy/safety.rego` — Rego policy (1129 lines). GROUP K (home-wide find/grep) machinery reused for the shallow-heavy-scan rule: `program_base`, `find_path_args`, `is_under_eval_cwd`, `is_known_goal_dir`, `is_cwd_or_relative`, `grep_is_recursive`.
- `src/rules/catalog.ts` — TS rule catalog (496 lines), mirrors rego message-for-message. New `scan` family entries land here.
- `src/rules/RuleRegistry.ts` — `RuleFamily` union type must be extended with new family for `du`/`rg`/`fd`/scan rules.
- `/home/bhd/.pi/agent/skills/active/atuin-history/SKILL.md` — atuin search skill. NOTE: `--author`/`--authors` flags documented here DO NOT exist in installed atuin version; only `--after/--before/--cwd/--exit/--limit/--cmd-only/--search-mode`.

## Documents
- atuin history.db (`/home/bhd/snap/atuin/43/.local/share/atuin/history.db`) — queried for past heavy-command habit (7d window).

## Code patterns
- GROUP K deny-rule shape (args + raw fallback, allow-class exemption) — `policy/safety.rego` lines ~860–1129. Pattern reused for the new rule.
- `path_depth` predicate = count of non-empty `split(p, "/")` segments — the depth gate for the ban.
