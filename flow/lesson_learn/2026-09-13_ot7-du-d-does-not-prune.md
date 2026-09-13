# LSL: OT7 — `du -d N` does not prune; `find -maxdepth` / `rg --max-depth` do

## Context
Plan gotcha `depth-cap-exempt` probe said `du -d 1 /` → allowed. Turn-1 incident was exactly `du -xh -d1 /` hanging 300s — du still *stats the entire tree*; `-d` only bounds *printing*. Treating `-d` as a bound would re-allow the incident command.

## Solutions
Exempt ONLY descent-pruning caps at N≤2: `find -maxdepth N`/`-maxdepth=N`, `rg --max-depth N`/`--maxdepth=N`. `du -d N` NOT exempt. GNU find uses single-dash `-maxdepth=N`, not `--maxdepth=` (fixture bug: `find /var --maxdepth=2` never matched).

## Gotchas
- `du -d` vs `find -maxdepth` look similar in CLI flags and are not the same IO model. Lock the distinction in the plan (OT7 RESOLVED) so the next implementer does not "fix" du exemption back in.
- Inline `=` form must be parsed per-program (`-maxdepth=` vs `--max-depth=` vs `--maxdepth=`).

## Ref
policy/safety.rego (`depth_cap_bounded`, `maxdepth_values`)
tests/fixtures/shallow-heavy-scan.json (du-depth-flag-shallow, find-maxdepth1-root, rg-maxdepth2-root)
flow/plans/ban-shallow-heavy-scan.md OT7
