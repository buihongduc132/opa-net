# Plan — Universal Shell Gate (PATH shim, all binaries, all processes)

- Origin: buihongduc132 2026-10-03, Slack #opa-net thread "shell gate": "how to make it to gate all shell usage instead of having to manual wired in per agent?"
- Rulings (verbatim, locked):
  - Scope: "ALL THE shell by itself ; NOT just narrowed to some kind of binary."
  - Humans: "ALL , to avoid attempting to cheat by anyone"
  - Override: "THE ONLY way that it could override is to mint the OVERRIDE key. Override key is already done but workflow is TBD , do not need to bother with this now."
- Related: `flow/plans/2026-10-03-branch-gate-main-dir.md` (S1–S8; GROUP G rules + engine repair). This plan SUPERSEDES the "wire per-agent plugins" approach (old S7) as the enforcement wall; plugins remain optional UX.
- Deliverable: EVERY process on bhd-main — agents (any CLI), humans, root, cron, systemd units, tmux — resolves binaries through an opa-net shim; deny rules apply everywhere; only a minted unlock key overrides.

## Architecture

- Shim dir `/opt/opa-gate/bin`, prepended to PATH in every env source → wins resolution for EVERY executable name without touching any agent config.
- One dispatch script `/opt/opa-gate/bin/.opa-gate-shim`; per-binary shims are symlinks (basename = real binary name); dispatch resolves the REAL binary via fixed path table (`/usr/bin/<name>`, `/bin` → usrmerge), NEVER by re-searching PATH (no recursion).
- Every invocation: `pi-opa-net eval "<name> <args>" --json` → allow → `exec <real-binary> "$@"`; deny → exit non-zero, reason on stderr (consumable by agents + humans).
- Engine failure (eval error, F1-class): fail-OPEN exec (never brick the host), but deny-persistence depends on engine health → health timer alerts Slack (P6).
- Audit: every eval appends decision JSONL to `/var/log/opa-gate/audit.jsonl` (LD-Y2 audit-sink seam) — machine-readable ground truth, replaces atuin (useless: agents run non-interactive subshells).
- Boot safety (metal-ops wiring rule): shim-sync units = oneshot + daily idle-priority timer, `systemd-analyze verify` exit 0, NOT in boot-critical path, atomic swap of shim dir; engine timeout 500ms hard-capped so early-boot callers can never hang.
- `sudo`: `secure_path` gets shim dir FIRST — root invocations gated too (ruling). NO exempt users.

## Steps

### P0 — Prereq: engine unbrick (F1) · coder · 30–60min
- Action: execute S1 of branch-gate plan (both install roots: `~/.pi/agent/packages/opa-net` + global mise CLI; `ajv/dist/core.js` exists; smoke `pi-opa-net eval "git stash pop" --json`).
- Verify: real `decision` JSON from both roots.
- Acceptance: no module error. Shim without a working engine = fail-open theater.

### P1 — Shim + population script · coder · 1–2h
- Action: write `.opa-gate-shim` (bash, zero-dep, boot-safe) + `opa-gate-populate` (creates symlink per executable found in `/usr/bin /usr/local/bin /bin /usr/sbin`, skipping the shim dir itself and `sudo` itself — sudo must stay real or secure_path recursion bites). Unlock-key seam: pass through `OPA_UNLOCK*`/`--unlock` env to engine (workflow TBD per ruling — wire seam only, do NOT build minting flow).
- Verify: `PATH=/opt/opa-gate/bin:$PATH git status` works in scratch repo; `git checkout <feature>` denied in `slack-configuration` (MAIN fixture); `git checkout test` allowed (allowlist F5).
- Acceptance: dispatch correct for 20 random binaries; symlink count = source executable count.

### P2 — Perf gate · coder · 30min
- Action: `hyperfine` 100× `git status`, `ls`, `echo`-class through shim.
- Verify: median overhead < 100ms/cmd (bun/opa startup dominates). If exceeded → add fast-path prefix allowlist (read-only arg patterns exec directly, still audit-logged).
- Acceptance: measured numbers saved in findings doc; hot loops (`for i in seq; do ls; done`) don't regress scripts measurably.

### P3 — Global env wiring · devops · 1h
- Action: `/etc/environment` (PAM), `/etc/profile.d/opa-gate.sh` (login shells), `DefaultEnvironment` in `/etc/systemd/system.conf` + `user.conf` (units + systemd-run), sudoers.d `secure_path="/opt/opa-gate/bin:…"`, tmux inherits session env. Cron: PATH line injected via `/etc/default/cron`-equivalent for crontabs the gate owns (agent crons run through systemd timers → covered by DefaultEnvironment).
- Verify matrix (each → `command -v git` = `/opt/opa-gate/bin/git`): fresh ssh login, ssh non-login (`ssh host cmd`), `bash -lc`, `bash -c`, `sh -c`, `env -i /bin/bash -c`, `sudo git …`, `sudo -i`, systemd-run transient, tmux new-window, cron entry.
- Acceptance: 10/10 contexts resolve through shim; none bypass.

### P4 — Boot-safety proof · devops · 1h
- Action: opa-gate-populate.service (oneshot) + .timer (daily, `CPUSchedulingPolicy=idle`, `Nice=19`); atomic shim-dir swap (populate to staging dir, `mv` swap). NEVER let units gate their own binaries (absolute paths in ExecStart).
- Verify: `systemd-analyze verify` exit 0 on both units; `systemd-analyze critical-chain` unchanged vs pre-gate snapshot; grep sysinit/basic.target wants for PATH-relative ExecStart (expect zero); simulate engine-dead at boot (rename opa binary) → `systemctl` basic boot unaffected, health alert fires.
- Acceptance: boot-critical path clean; documented in findings. Bare-metal reboot test = separate user-approved window (risk R6).

### P5 — RED→GREEN coverage matrix · devops + verifier · 1h
- Action: run E1–E10 escape matrix (branch-gate plan) through EVERY P3 context in MAIN fixture (all deny) + old lane worktree (all allow) + fresh <3d worktree (deny, R2). Plus cheat-attempt probes: `/usr/bin/git checkout <feat>` (documented residual), `env PATH=/usr/bin git …` (documented residual), `xargs /usr/bin/git` (residual).
- Verify: results saved to `flow/findings/2026-10-03-universal-shell-gate/matrix-*.jsonl`; verifier subagent re-runs independently (synchronous only, no background searches).
- Acceptance: 10 deny × 10 contexts in MAIN; known residuals listed RED in findings — no silent gaps.

### P6 — Health + watchdog · devops · 1–2h
- Action: `opa-gate-health.timer` (5min: eval smoke; failure → Slack #opa-net + audit log). Extend S8 reflog watchdog: scan `audit.jsonl` for deny-storms (agent fighting the gate) + absolute-path git invocations from agent-owned processes (residual detector). Log caps per infra-risk-guard: jsonlog rotate `max-size=10m max-file=3`.
- Verify: kill engine → alert < 5min; fake deny-storm fixture → alert; `systemctl daemon-reload` survives.
- Acceptance: E2E alarm round-trip proven; no unbounded log growth.

### P7 — Fleet roll (other machines) · devops · TBD
- Action: NON-GOAL v1 — bhd-main only. Matrix.json machines (bhd-main2, cfly-*) get same units later via existing deploy convention.
- Acceptance: noted as non-goal.

### P8 — Docs + skill + scaffold · planner · 30min
- Action: opa-net root AGENTS.md TOC line (metal-ops rule); update `bash-safety-gate` skill guard map (shim = fleet-wide wall, plugins = UX layer); flow/plans + findings index.yml entries.
- Verify: `rg opa-gate AGENTS.md` hit; skill reload shows new layer.
- Acceptance: next agent auditing "why did X pass" finds the shim layer documented.

## Sequencing

P0 → P1 → P2 → P3 → P4 → P5 → P6 → P8; P7 deferred. Critical path ≈ 5–8h (coder P0–P2, devops P3–P6).

## DOD

1. Every invocation context (P3 matrix) resolves binaries through the shim; sudo included.
2. E1–E10 deny in MAIN across contexts; allow in ≥3d worktrees; deny in <3d worktrees (R2).
3. Engine-dead → fail-open exec + Slack alert < 5min; boot unaffected (P4).
4. audit.jsonl rotating, capped; watchdog alerts on deny-storms + residual absolute-path usage.
5. Only unlock-key minting can override (seam wired, workflow TBD — user ruling).
6. Plan + findings + AGENTS.md + skill updated.

## Risks

- R1 sudo locked-out recovery: no exempt users → break-glass = physical console / single-user mode. Runbook in findings.
- R2 perf on binary-hot scripts → P2 fast-path (allowed, logged).
- R3 fail-open window while engine dead → health timer + alert; engine repair procedure = S1 lesson.
- R4 absolute-path/execve-direct residuals → documented RED in findings; watchdog detects; unlock-key is the sanctioned path.
- R5 early-boot PATH surprises → P4 proof + 500ms cap + fail-open.
- R6 bare-metal reboot untested → user-approved window before calling P4 fully proven.
- R7 shim drift vs newly installed binaries → daily populate timer + post-`apt install` hook (P6 add-on if needed).

## Handoff

- Executor: h-bhd-main-coder (P0–P2), devops (P3–P6); verifier lane re-runs P5 matrix synchronously.
- This plan is input; sibling branch-gate plan S1/S2/S4/S5 outputs (engine + rules) are prerequisites/inputs.
