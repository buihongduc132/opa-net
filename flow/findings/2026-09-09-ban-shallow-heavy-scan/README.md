# Ban Shallow Heavy Scan

> Date range: 2026-09-09 → 2026-09-09
> Status: explore-ongoing

## Topics

### ban-shallow-heavy-scan (2026-09-09)
Explored banning heavy recursive commands (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) when they target `/` or a 1–2 level path (they saturate disk IO and hang — `du -xh -d1 /` timed out at 300s while `/` is 99% full). Designed a single depth-gated deny rule reusing GROUP K machinery, with `eza -T -L 2` as the mandatory discovery step before any depth-≥3 scan. Locked: heavy cmds banned at depth ≤2, allowed depth ≥3; `du` allowed at depth 3; use eza first. Open: whether "depth 3" means exactly 3 or ≥3; implementation landing (GROUP L in safety.rego + catalog + RuleFamily); atuin evidence shows heavy scans are agent-internal so guard must live at the tool-call path.

## Pick up next time
1. `2026-09-09-turn4-atuin-findings-du-lock.md` — latest evidence + du lock
2. `2026-09-09-locked-decisions.yaml` — LD1–LD4 locked
3. `2026-09-09-open-threads.yaml` — OT1 (du depth ≥3 vs =3) is the only decision gate before plan
