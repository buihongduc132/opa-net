# Gate home-wide find/grep (allow scoped walks)

> Plan ID: `gate-home-wide-find-grep`
> Created: 2026-08-23 · Last reconciled: 2026-08-23
> Status: done (GROUP K merged into policy/safety.rego + catalog; e2e tests/e2e/block-home-wide-find-grep.test.ts green; /tmp expectation superseded by GROUP L — see ban-shallow-heavy-scan.md)
> Branch: test/bhd-195-red-home-wide-find-grep (PR #13)
> Location: flow/plans/gate-home-wide-find-grep.md

## Requirement (verbatim)
Describe this and make it to research how to mitigate / gate it while still allow us to operate normally when needed

```
find /tmp /home/bhd -maxdepth 4 -name completion.json -newermt 2026-08-23
```
PID 3224795, D / wait_on_buffer. Parent bash from pi 352147, cwd bhd-metal-ops, wezterm scope.

Earlier D-finds (21:35, same class — agent tree walks, not a daemon):
- find /home/bhd -name goal.json -mmin -15
- find …Projects -name .wt-context.json
- find beet-orches -name process-incoming-object.js
- grep -rl BHD-156 ~/.hermes --include=*.db

Source: bhd-metal-ops `flow/intentions/2026-08-23_gate-home-wide-find-grep.md` + findings `2026-08-23_agent-home-wide-find-dstate.md`. Engineering: opa-net `policy/safety.rego` (fail-open, program/args model), no existing `find /home` catalog rule (probe 2026-08-23).

## DOD (Definition of Done)
Plan done when ALL below true:
- [x] Research names the deny class (home-rooted `find` / recursive `grep` on `$HOME` / `~/.hermes/*.db`) vs allow class (cwd-scoped, maxdepth+name, known goal dirs)
- [x] Mitigation is a **gate** (opa-net rule + unlock for genuine ops), not a host kill of `pi`/`node`
- [x] False-positive list exists (wt-reap-idle, gitnexus backup, `find <repo> -name foo`, `rg` in a worktree)
- [x] Decision recorded: deny vs warn vs PSI-gated deny; fail-open preserved unless explicitly changed

## Tasks

### Research
- [x] class-deny: documented AST/regex shape for `find $HOME|/home/<user>` and `grep -r`/`grep -rl` on `~/.hermes` `*.db` (compound `bash -c` must still match)
- [x] class-allow: documented allow: `find .`, `find <repo>`, `find ~/.pi/goals`, `find ~/.verifier-loop/goals`, maxdepth≤2 under `.worktrees`
- [x] unlock: trusted-agent unlock-key path named so a human/ops session can still walk home when needed (auditable `source:'opa-unlocked'`)
- [x] psi-opt: optional PSI/iowait gate researched (deny only when `io some avg10` above threshold) — accept or NAK with reason
- [x] false-pos: wt-reap-idle `find $HOME/Documents/Projects … .wt-context.json` classified (agent hook vs systemd unit — unit may not hit opa-net)

### Catalog (implementation later; research must not skip)
- [x] no-rule-now: 2026-08-23 probe: `src/rules` has no `find` home-walk rule; `policy/safety.rego` has no `program == "find"` deny — gap confirmed
- [x] tests-later: fixture cmds from live PIDs (completion.json walk, goal.json, hermes *.db grep) have deny/allow expected outcomes written as research table

## Idempotency
Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Open Threads
- OT-systemd: user-timer `wt-reap-idle` does not pass pi bash hook — opa-net alone will not stop it.
- OT-bash-c: parent is `bash -c '…; find …'` — parser must see inner program, not only `bash`.
