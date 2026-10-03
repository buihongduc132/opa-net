# Plan — opa-gate 7 bypass-vector triage + fix (agy audit, 2026-10-04)

## Context (verbatim ask)

> PLAN — triage the 7 active bypass vectors in agy's audit and produce a declarative FIX plan (which are valid/real/in-scope to fix vs documented residual).
> Deliverable: a flow/plans doc — per-vector verdict (fix / residual / not-a-real-bypass), pinned file:symbol seams at current HEAD (wt/universal-shell-gate b745126), strict machine-checkable DOD per fix, and a RED→GREEN test matrix. MUST invoke :cmd-pallet-gotcha-coverage:. Commit+push to a branch, reply here with plan pointer + which vectors are IN vs OUT.

- Origin: buihongduc132 2026-10-04, Slack #opa-net thread "Git hooks request".
- Source audit: agy-connector, <https://dy-swarm.slack.com/archives/C0C42KW561E/p1791053951280019>.
- Seams pinned at: `wt/universal-shell-gate` @ `b745126` (`b7451269879960bffcbbae953c4698e9b6fc6a4c`).
- HEAD drift note: branch advanced `b745126` → `2457eb4` (2 script-only commits landed mid-triage: `4f38713` watchdog Slack-silence, `2457eb4` shim audit-append helper). All cited seams RE-VERIFIED unchanged at `2457eb4` — `safety.rego`, `run.ts`, and all `src/parser/*` untouched; `.opa-gate-shim` guard block still `:11-24` (file grew 184→196 lines, audit-append only).
- Deployed (live): `/opt/opa-gate/engine` (rulebook_digest `07f500d393d2`, pi-opa-net 0.7.0, opa 1.18.2) + `/opt/opa-gate/bin/.opa-gate-shim`.
- Related: `flow/plans/2026-10-03-universal-shell-gate.md` (P0–P8, the wall this hardens), `flow/plans/2026-10-03-branch-gate-main-dir.md` (S1–S8, GROUP G rules).

## Triage — verdicts

Every vector RE-VERIFIED against code at `b745126` + live `pi-opa-net eval` probes on the deployed engine. All 7 are REAL (none is a false positive). 6 IN / 1 OUT.

| # | Vector | Verdict | Live proof (deployed engine) |
|---|---|---|---|
| V1 | `OPA_GATE_INTERNAL=1` env spoof | **REAL — Critical — FIX** | `OPA_GATE_INTERNAL=1 /opt/opa-gate/bin/git …` exits 0, no engine eval, no audit entry |
| V2 | `git -c alias.co=checkout co <branch>` | **REAL — High — FIX** | `{"decision":"allow"}` (subcommand `co` unresolved) |
| V3 | `git branch -m <name>` | **REAL — High — FIX** | `{"decision":"allow"}` (only `-f/-M/-C` blocked) |
| V4 | `cd <repo> && git checkout <branch>` | **REAL — Medium — FIX** | `{"decision":"allow"}` (baseCwd not tracked across segments) |
| V5 | `git symbolic-ref @ …` | **REAL — Medium — FIX** | `{"decision":"allow"}` (matches `HEAD` only, not `@`) |
| V6 | `git update-ref --stdin` | **REAL — Medium — FIX** | `{"decision":"allow"}` (stdin refs ignored) |
| V7 | direct `/usr/bin/git` + PATH precedence | **REAL — Residual — OUT** | `which git` = `~/.local/bin/git` (legacy wrapper) in current shell; `/usr/bin/git` bypasses shim |

### V7 nuance (documented residual, NOT a shim fix)

Two distinct sub-gaps, both structural to a PATH-wrapper (no in-shim fix possible):

- **Direct path invocation** (`/usr/bin/git …`, `execve` via `python subprocess`, `xargs /usr/bin/git`): no PATH wrapper can intercept absolute-path exec. Mitigation already deployed: reflog watchdog (`scripts/branch_drift_watchdog.py`, S8) + `audit.jsonl` + health alert. RED residual by design (see P5 of universal-shell-gate plan).
- **PATH precedence / legacy-wrapper shadowing**: `/etc/environment` + `/etc/profile.d/opa-gate.sh` prepend `/opt/opa-gate/bin`, but shells whose PATH puts `~/.local/bin` first (current hermes-agent shell, tmux panes started pre-reload, daemons with own env) resolve `git` to the OLD `prompts`-repo wrapper `~/.local/bin/git` — a **second, divergent gate**. The universal-shell-gate plan (P3) targeted 10 contexts but did NOT retire the legacy `~/.local/bin/git` wrapper. This is a configuration/completion gap, not a code bypass — tracked separately, OUT of this fix cycle.

## Declarative Items (fixes)

Each item: stable id, action, seam, machine-checkable DOD probe, RED→GREEN.

### (v1) — kill the spoofable recursion-guard sentinel · Critical

- **Action**: Replace the inheritable `OPA_GATE_INTERNAL=1` sentinel with a non-spoofable re-entrancy check. The guard's only legitimate use is a CHILD of a shim-exec'd binary re-entering `/opt/opa-gate/bin`; a non-shim caller must ALWAYS be evaluated. Recommended seam: at entry, honor the guard only when the PARENT process's executable resolves under `/opt/opa-gate/bin` (`readlink /proc/$PPID/exe` starts with `/opt/opa-gate/bin/`); otherwise evaluate policy regardless of any `OPA_GATE_INTERNAL` value. Alternatively mint a per-invocation nonce into a root-owned marker under `/run/opa-gate/` and require the child to present it — pick one, do NOT keep the static `= "1"` string check.
- **Seam**: `scripts/.opa-gate-shim:11-20` (guard) + `:22-24` (sets `OPA_GATE_INTERNAL=1`).
- **DOD (machine)**: `OPA_GATE_INTERNAL=1 /opt/opa-gate/bin/git checkout feature-evil` in a protected worktree → **exit 2**, stderr `branch-target-allowlist`, and an `audit.jsonl` entry with `source` NOT `fast-path`. Also: parent-is-shim re-entry still passes (no double-eval loop on `sudo`-style nested invocations).
- **RED→GREEN**: RED = exits 0, no audit entry (spoof wins). GREEN = exit 2 + audit entry (spoof ignored, policy fires).

### (v2) — resolve git aliases before policy · High

- **Action**: Canonicalize git subcommand aliases before rego sees them. Capture `-c alias.X=Y` (currently stripped+dropped by `stripWithMeta`) AND `.git/config` `alias.X`; if the parsed `subcommand` is a defined alias, replace it with the resolved subcommand and re-classify args. Simplest correct implementation: a pre-pass in `src/parser/` (new `resolveGitAlias` invoked from `ShellQuoteParser.classify` / coordinator) that returns a resolved `ParsedCommand`. Fail-closed fallback if resolution is infeasible: deny any `git` subcommand not in the known-builtins allowlist when `repo_available_protected` is true.
- **Seam**: `src/parser/stripGitGlobalOptions.ts:15-23,87-89,117-119` (`-c` consumed, alias value discarded) + `src/parser/ShellQuoteParser.ts:83-98` (subcommand = raw token, no alias lookup) + `policy/safety.rego:818-840` (checks `checkout`/`switch` literal only).
- **DOD (machine)**: `pi-opa-net eval 'git -c alias.co=checkout co feature-evil' --json` in a protected repo → `"decision":"deny"` with `subcommand` resolved to `checkout` (or alias-expanded) in `input`. Also `.git/config` alias form `git co feature-evil` → deny.
- **RED→GREEN**: RED = `allow`, `subcommand:"co"`. GREEN = `deny`, alias resolved to `checkout`.

### (v3) — block `git branch -m/--move` in protected worktrees · High

- **Action**: Add a rego deny rule for `git branch -m` / `--move` gated on `repo_available_protected`. `git branch -m` renames the CURRENT branch in place (no checkout/switch), so it moves a protected branch off the allowlist silently. Existing rule `safety.rego:170-175` blocks `-f/-M/-C` only (and is un-gated/global); `-m` is allowed. Because `input.signals.git.current_branch` is `null` (`run.ts:318`) the old name is unverifiable → fail-closed: block ALL `branch -m/--move` in protected worktrees (unlock key overrides). Leave non-protected feature worktrees free to rename their own WIP branch.
- **Seam**: `policy/safety.rego:170-175` (existing force-block, add `-m`/`--move` gated variant) + GROUP G block `:765-925`.
- **DOD (machine)**: `pi-opa-net eval 'git branch -m feature-evil' --json` in a protected repo → `"decision":"deny"`. In a ≥3d worktree → still `allow` (scope preserved).
- **RED→GREEN**: RED = `allow`. GREEN = `deny` (protected) / `allow` (old worktree).

### (v4) — track cwd across compound segments · Medium

- **Action**: In `evaluatePossiblyCompound`, detect leading `cd`/`pushd`/`popd` segments and propagate an `effectiveCwd` to subsequent segments (so `cd /repo && git checkout X` evaluates `git` against `/repo`, not `process.cwd()`). Fail-closed: a `cd` target that can't be resolved → deny. NOTE the shim is IMMUNE here (`cd` is a shell builtin, never reaches the shim; the shim always evals single binary invocations with the already-changed cwd) — this fix hardens the **direct-eval seam** (`pi-opa-net eval`, pi `tool_call` hook, agy), which DOES receive compound strings.
- **Seam**: `src/cli/run.ts:94` (`baseCwd = process.cwd()`) + `:160-167` (compound loop passes unchanged `deps`/`baseCwd`) + `src/parser/splitTopLevelSegments.ts:41-117` (splits on `&&` etc.).
- **DOD (machine)**: `cd /tmp && pi-opa-net eval 'cd /home/bhd/Documents/Projects/bhd/opa-net && git checkout feature-evil' --json` → `"decision":"deny"`. Plain `pi-opa-net eval 'git checkout feature-evil' --json` with cwd already in the repo → unchanged deny.
- **RED→GREEN**: RED = `allow` (git segment evaled against `/tmp`, `repo.available=false`). GREEN = `deny` (git segment evaled against `/repo`).

### (v5) — treat `@` as HEAD in symbolic-ref · Medium

- **Action**: Extend `symbolic_ref_mutates_head` (and the update-ref HEAD helper for parity) to treat `@` as the `HEAD` shorthand. `git symbolic-ref @ refs/heads/feature-evil` mutates HEAD but currently matches only the literal `HEAD` arg.
- **Seam**: `policy/safety.rego:874-896` (`symbolic_ref_mutates_head`, three clauses all test `arg == "HEAD"`).
- **DOD (machine)**: `pi-opa-net eval 'git symbolic-ref @ refs/heads/feature-evil' --json` in a protected repo → `"decision":"deny"`. Read-only `git symbolic-ref @` → still `allow`.
- **RED→GREEN**: RED = `allow`. GREEN = `deny` (mutation via `@`) / `allow` (read-only).

### (v6) — block `update-ref --stdin` in protected worktrees · Medium

- **Action**: Add a deny clause: `input.subcommand == "update-ref"` AND `has_any_arg(input.args, ["--stdin"])` AND `repo_available_protected` → deny. Stdin-driven ref mutations (`printf 'update refs/heads/main …\n' | git update-ref --stdin`) are unverifiable from argv → fail-closed block in protected worktrees (unlock key overrides).
- **Seam**: `policy/safety.rego:908-925` (`update_ref_targets_branch` inspects argv only; `--stdin` form has no ref args).
- **DOD (machine)**: `pi-opa-net eval 'git update-ref --stdin' --json` in a protected repo → `"decision":"deny"`. Argv form `git update-ref refs/heads/main <sha>` → still `deny` (already covered).
- **RED→GREEN**: RED = `allow`. GREEN = `deny`.

### (v7) — residual (OUT of fix cycle)

- No code change. Document as RED residual. Mitigation = reflog watchdog + audit + health alert (already deployed). Future hardening (landlock/BPF per-exec interception) is a separate, kernel-level scope — explicitly out.

## RED→GREEN test matrix (single pass, protected-worktree fixture)

| Probe (deployed engine/shim) | RED now | GREEN after |
|---|---|---|
| `OPA_GATE_INTERNAL=1 /opt/opa-gate/bin/git checkout feature-evil` | exit 0, no audit | exit 2 + audit |
| `pi-opa-net eval 'git -c alias.co=checkout co feature-evil' --json` | allow | deny |
| `pi-opa-net eval 'git branch -m feature-evil' --json` | allow | deny |
| `cd /tmp && pi-opa-net eval 'cd <repo> && git checkout feature-evil' --json` | allow | deny |
| `pi-opa-net eval 'git symbolic-ref @ refs/heads/feature-evil' --json` | allow | deny |
| `pi-opa-net eval 'git update-ref --stdin' --json` | allow | deny |
| `/usr/bin/git checkout feature-evil` (residual) | allow (watchdog flags) | allow (watchdog flags) — no change |

Protected-worktree fixture: main repo checkout (`/home/bhd/Documents/Projects/bhd/opa-net` on `main`) or a <3d worktree. Non-protected control: any ≥3d worktree must flip each of V3/V5/V6 back to `allow` (scope not over-broadened).

## Sequencing

V1 (Critical, shim) → V2 → V3 → V5 → V6 (rego, independent, parallelizable) → V4 (run.ts). V1 blocks everything else's shim-path effect, so it ships first. V2–V6 are independent rego/parser edits; V4 is the only TS-control-flow change.

## DOD (whole plan)

1. All 6 IN vectors flip RED→GREEN on the deployed engine/shim (matrix above, machine-checked `--json`).
2. V7 stays RED and is explicitly documented as residual (watchdog + audit mitigation), not silently claimed fixed.
3. Non-protected ≥3d worktrees retain `allow` for V3/V5/V6 (no over-broadening).
4. Rego digest re-pinned in health check (`opa-gate-health` rulebook_digest) after safety.rego changes.
5. Full `bun test` + `bun run typecheck` green; new rego rules have a `tests/unit`/`tests/e2e` case each.
6. Shim boot-safety preserved: `systemd-analyze verify` exit 0 on opa-gate units; engine-dead still fail-OPEN.
7. Gotcha appendix (`2026-10-04-opa-gate-bypass-vectors-gotcha.md`) written (see `## Gotcha Coverage`).

## Risks

- R1 (V1 fix) breaking legitimate nested invocation (`sudo`, engine-internal `git`) → must preserve re-entrant pass-through; DOD covers parent-is-shim case.
- R2 (V2) alias resolution scope: `.git/config` aliases are per-repo and one-shot `-c` aliases are ephemeral; resolution must not introduce an eval of attacker-controlled config as code (read-only `git config --get`).
- R3 (V3/V6) over-broadening: blocking rename/stdin-refs in ALL protected worktrees may annoy legit work in young worktrees → unlock-key is the sanctioned override (LD-L1/L2).
- R4 (V4) cwd-tracking correctness: `cd` parsing must stay quote-aware (reuse `splitTopLevelSegments` tokens), never eval an un-quoted path as a directive.
- R5 rego digest drift: every safety.rego edit invalidates the health-check pin → re-pin or the health alert fires false positives.

## Handoff

- Executor: h-bhd-main-coder (V1–V6), verifier lane re-runs the RED→GREEN matrix synchronously against the deployed engine.
- Fix branch base: `wt/universal-shell-gate` @ `b745126` (NOT `main`, which lacks the P0–P8 implementation).
- This plan is the fix spec; the universal-shell-gate plan (P0–P8) is the wall it hardens — do not re-architect the shim, only close the 6 leaks.

## Gotcha Coverage

See sibling `2026-10-04-opa-gate-bypass-vectors-gotcha.md` (appendix, append-only) — 24 gotchas, ranked G1–G24.

## Open Threads (from gotcha coverage — append-only)

- **OT-1 — V1 fix approach corrected (G1, Rank 5)**: the `/proc/$PPID/exe` parent check is vacuous — the shim never persists as a process under `/opt/opa-gate/bin` (always `exec`s the real binary). Re-scoped: **drop the vestigial recursion guard entirely** (`.opa-gate-shim:11-20`; `:195` already unsets the sentinel before every allow-exec) **or** pass a nonce via an inherited secret fd. NOT `/proc/$PPID`, NOT env, NOT a world-readable marker. Item `(v1)` status: **blocked pending approach decision**.
- **OT-2 — V7 split (G20, Rank 4)**: the "PATH precedence" half is NOT a true residual. **V7a** = retire/repoint the legacy `~/.local/bin/git` wrapper (one-line config, IN-scope, cheap). **V7b** = direct `/usr/bin/git`/execve absolute-path (true residual, OUT). Re-verify V7a before claiming V7 fully OUT.
- **OT-3 — V2 fail-closed over-broadening (G4, Rank 4)**: blanket "deny unknown git subcommand in protected worktree" denies `git lfs/flow/secret` + bare `git`/`git --version`. Narrow the fallback (alias-resolution-failed AND not a resolvable builtin/extension), never blanket-deny.
- **OT-4 — V4 scope widens (G7/G8/G14)**: cwd redirection is not `cd`-only — `--git-dir`/`--work-tree`/`--namespace` (stripped-and-discarded) and cd variants (subshell, `pushd/popd`, `cd -`/`~`/no-arg) share the same class. Fix must capture those globals + a cwd stack; `splitTopLevelSegments` must return operators (correct `&&`/`||`/`;` short-circuit).
- **OT-5 — V5 two-spellings (G9, Rank 4)**: single `is_head_ref(arg)` = `"HEAD" | "@"` used in guard **and** exclusion (`not is_head_ref(other)`) + `update_ref_targets_branch`, else read-only `git symbolic-ref @` is wrongly denied.
- **OT-6 — V7 watchdog tamperability (G10, Rank 4)**: un-gated `git reflog expire/delete` + `core.logAllRefUpdates false` blind the residual detector. Add deny rules or mark the residual mitigation as defeatable.
- **OT-7 — env-knob drift (G6/G13)**: `PIOPANET_PROTECT_DAYS` (2 spellings) and unlock-keys (3 spellings) read raw outside `Config.ts`. Centralize to single accessor + single spelling.
