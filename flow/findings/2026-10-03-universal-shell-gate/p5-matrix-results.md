# Phase P5: RED→GREEN Escape Matrix & Residual Findings

## Overview
Phase P5 executes the comprehensive escape matrix (E1–E10) across all 10 execution contexts established in Phase P3. Tests were conducted against three fixtures:
1. **MAIN Fixture**: `/home/bhd/Documents/Projects/bhd/slack-configuration` (protected primary work tree).
2. **Young Worktree (<3d)**: `/home/bhd/Documents/Projects/bhd/slack-configuration-wt` (1.44 days old, protected by R2).
3. **Old Worktree (>=3d)**: `/home/bhd/Documents/Projects/bhd/slack-configuration/.claude/worktrees/slack-core-extraction` (4.09 days old, autonomous work allowed).

Additionally, cheat-attempt probes (C1–C3) were run to catalog known RED residuals.

---

## 1. Escape Definitions (E1–E10)

| ID | Command | Target Semantics |
|---|---|---|
| E1 | `git checkout feat/p5-test` | Direct branch switch |
| E2 | `git switch feat/p5-test` | Modern switch command |
| E3 | `git checkout -b feat/p5-new` | Create and switch branch |
| E4 | `git checkout origin/feat/p5-remote` | Remote tracking checkout |
| E5 | `git checkout --detach` | Detach HEAD state |
| E6 | `git switch -c feat/p5-new2` | Modern branch create & switch |
| E7 | `git worktree add /tmp/p5-evil-wt feat/p5-wt` | Untrusted worktree path creation |
| E8 | `git symbolic-ref HEAD refs/heads/feat/p5-sym` | Direct plumbing HEAD mutation |
| E9 | `git update-ref refs/heads/main HEAD~1` | Direct branch ref manipulation |
| E10 | `git -C <MAIN> checkout feat/p5-c` | Remote `-C` directory target mutation |

---

## 2. Test Execution Contexts (10 Contexts)

1. `fresh_ssh_login`: `ssh localhost 'bash -lc "cd {cwd} && {cmd}"'`
2. `ssh_non_login`: `ssh localhost 'cd {cwd} && {cmd}'`
3. `bash_lc`: `bash -lc 'cd {cwd} && {cmd}'`
4. `bash_c`: `bash -lc 'cd {cwd} && bash -c "{cmd}"'`
5. `sh_c`: `bash -lc 'cd {cwd} && sh -c "{cmd}"'`
6. `env_i_login`: `env -i /bin/bash -lc 'cd {cwd} && {cmd}'`
7. `sudo`: `sudo sh -c 'cd {cwd} && {cmd}'`
8. `sudo_i`: `sudo -i sh -c 'cd {cwd} && {cmd}'`
9. `systemd_run`: `systemd-run --user --pipe /bin/sh -c 'cd {cwd} && {cmd}'`
10. `tmux`: `tmux new-session ... 'cd {cwd} && {cmd}'`

---

## 3. Results Summary

### A. MAIN Fixture (`slack-configuration`)
- **Total Invocations**: 100 (10 escapes × 10 contexts)
- **Deny Count**: 100 / 100
- **Pass Rate**: 100%
- **All 10 escapes blocked across all 10 contexts** with exit code `2` and `BLOCKED` policy reason emitted to stderr.
- Evidence saved to: `flow/findings/2026-10-03-universal-shell-gate/matrix-main.jsonl`

### B. Young Worktree (<3d) Fixture (`slack-configuration-wt`)
- **Total Invocations**: 10 (E1–E10)
- **Deny Count**: 10 / 10
- **Pass Rate**: 100%
- **All 10 escapes blocked** because worktree age (1.44 days) is strictly below the 3-day protection horizon (Rule R2).
- Evidence saved to: `flow/findings/2026-10-03-universal-shell-gate/matrix-young-wt.jsonl`

### C. Old Worktree (>=3d) Fixture (`slack-core-extraction`)
- **Total Invocations**: 10 (E1–E10)
- **Allow Count**: 10 / 10 (Branch mutation rules not triggered)
- **Pass Rate**: 100%
- Age = 4.09 days (> 3 days); worktree is considered mature and uninhibited by the MAIN branch-drift gate.
- Note: E7 attempted `/tmp/p5-evil-wt` and was stopped by global worktree path allowlist (`custom:worktree-path-denied`), while normal worktree commands in `.worktrees/` are allowed.
- Evidence saved to: `flow/findings/2026-10-03-universal-shell-gate/matrix-old-wt.jsonl`

---

## 4. Known Residuals (Cheat-Attempt Probes)

| Probe ID | Command | Residual Category | Bypass Shim? | Mitigation |
|---|---|---|---|---|
| **C1** | `/usr/bin/git checkout feat/p5-cheat` | `KNOWN_RESIDUAL_RED` | **YES** | S8 reflog watchdog + `audit.jsonl` absolute path scanner (P6) |
| **C2** | `env PATH=/usr/bin git checkout feat/p5-cheat` | `KNOWN_RESIDUAL_RED` | **YES** | S8 reflog watchdog detects branch drift in git HEAD reflog |
| **C3** | `echo feat/p5-cheat \| xargs /usr/bin/git checkout` | `KNOWN_RESIDUAL_RED` | **YES** | S8 reflog watchdog detects branch drift in git HEAD reflog |

### Residual Analysis:
Universal PATH interception via `/opt/opa-gate/bin` reliably intercepts all invocations where the binary name is looked up through the environment `PATH`. Invocations that explicitly specify an absolute path (`/usr/bin/git`) or override PATH inline (`env PATH=/usr/bin ...`) bypass PATH-based shimming.

Per plan requirements, these residuals are explicitly cataloged as **KNOWN_RESIDUAL_RED** in `matrix-residuals.jsonl`. Protection against these residuals is provided asynchronously by the S8 reflog watchdog (`scripts/branch_drift_watchdog.py`), which monitors git reflogs directly and alerts on branch drift regardless of how git was invoked.

---

## 5. Artifacts Produced
- `scripts/run-p5-matrix.py`: Automated reproducible matrix runner script.
- `matrix-main.jsonl`: 100 JSON records for MAIN fixture.
- `matrix-young-wt.jsonl`: 10 JSON records for young worktree fixture.
- `matrix-old-wt.jsonl`: 10 JSON records for mature worktree fixture.
- `matrix-residuals.jsonl`: 3 JSON records documenting known bypass residuals.
