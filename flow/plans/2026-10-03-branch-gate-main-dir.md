# Fix Plan — Branch-Change Gate (GROUP G) Must Actually Fire

- Origin: buihongduc132 2026-10-03, Slack opa-net thread (verbatim in findings/2026-10-03-branch-gate-not-firing).
- Findings doc (root causes F1–F6): `flow/findings/2026-10-03-branch-gate-not-firing/findings.md`
- Deliverable: an agent in a project MAIN dir CANNOT move HEAD off the allowlist by ANY git path; worktrees/lanes stay free.
- Requirement R2 (user, 2026-10-03, verbatim): "worktree created during last 3 days have the protection of non-changing-branch as well" → worktrees YOUNGER than 3 days get the SAME gate as MAIN dirs (age ≥ 3 days → free). Age = first entry timestamp of the worktree's own HEAD reflog (`.git/worktrees/<id>/logs/HEAD`), fallback dir mtime. Config knob `PIOPANET_WORKTREE_PROTECT_DAYS` (default 3).

## Incident evidence (2026-10-03, gy audit — ground truth)

- 48h window: **15 real branch changes** across 5 repos/worktrees (git reflogs `.git/logs/HEAD` + worktree logs).
- **MAIN-dir violations (the sick pattern — gate would have killed these): 2**
  - `slack-configuration` main → `wt/agy-mcp-bridge-doc` (2026-10-02 13:30)
  - `tailscale-acl` main → `app-connectors-20261002` (2026-10-02 23:36, back 04:55)
- Remaining 13 = worktree-lane flips (`beet-orches` cp-gig-fop-*, `crud-agy-all`) → BY DESIGN free.
- **R2 impact (live-verified 2026-10-03):** `cp-gig-fop-window` age = 2d (first HEAD-reflog entry 2026-09-30 17:00 +0700, field 6 of the reflog line) → the 7+ gig-fop lane flips WOULD have been blocked under R2. Only the R2 rule makes the watchdog/gate cover the actual worst offender. Reflog line shape: `<old> <new> <name> <email> <unix-ts> <tz> <msg>` — age = FIRST line, field 5 (unix ts).
- **Atuin = USELESS for this audit: 0 git commands recorded** — agents exec via non-interactive subshells, atuin only hooks interactive prompts. VERIFICATION MUST USE GIT REFLOGS + opa-net audit JSONL, never atuin.

## DOD (whole plan)

1. `pi-opa-net eval` NEVER errors on ajv — both install roots print a decision JSON (fix F1).
2. In MAIN dir, every escape in matrix below → `deny`; allowed branches → `allow` (F2–F5).
3. `bun test` green incl. new tests; catalog↔rego parity test green.
4. Both deploys (pi stage-1 `~/.pi/agent/packages/opa-net`, global CLI) verified by LIVE eval matrix, RED first.
5. User allowlist `{dev, main, staging, test, stag, master}` wired via env/config default on host.
6. **R2**: in a worktree YOUNGER than 3 days → same E1–E10 deny matrix; worktree ≥3 days old → all allow. Age signal unit-tested with faked clocks.

## Escape matrix (verification basis — all must DENY in main dir)

| # | Command | Today | Why hole |
|---|---------|-------|----------|
| E1 | `git checkout <feature>` | rule exists | dead: ajv fail-open (F1) |
| E2 | `git switch <feature>` | rule exists | dead: F1 |
| E3 | `git checkout -b <new>` | ALLOW | `-b` not in FLAGS_NO_VALUE; classifier → commit-ish (F3) |
| E4 | `git checkout origin/<x>` (no local) | ALLOW | commit-ish → detached escape (F3) |
| E5 | `git checkout <sha>` / `--detach` | ALLOW | detached HEAD = branch change, ungated (F4) |
| E6 | `git switch -c <new>` | ALLOW | create+switch ungated (F3/F4) |
| E7 | `git worktree add <path> <branch>` | path-gated only | branch dimension ungated (F4) |
| E8 | `git symbolic-ref HEAD refs/heads/<x>` | ALLOW | raw ref move (F4) |
| E9 | `git update-ref refs/heads/<cur> <sha>` | ALLOW | moves branch under feet (F4) |
| E10 | `git -C <main-dir> checkout <x>` | rule exists | needs gitCwd propagation e2e (LD8) — verify |

Worktrees: **age-split (R2)** — YOUNGER than 3 days → E1–E10 all DENY (same as main); ≥3 days old → E1–E10 all ALLOW (roam free). Age = first HEAD-reflog entry (fallback dir mtime).

## Steps

### S1 — Unbrick engine (F1) · coder · 30–60min
- Action: reinstall/repair `node_modules` in BOTH roots (`bun install --force` in repo, then re-sync stage-1 + global: follow repo's own deploy lesson 84b2ff5; do NOT hand-patch node_modules).
- Verify: `pi-opa-net eval "git stash pop" --json` (repo smoke cmd) OK from BOTH roots; `ajv/dist/core.js` exists.
- Acceptance: F1 repro command returns real `decision` (allow or deny), not module error.

### S2 — Protected-dir detection per user spec (F2 + R2) · coder+planner · 1.5–2.5h
- Action: extend `RepoSignals` —
  - **Main-dir rule (F2)**: linked worktree → git-native. Standalone clone → among sibling dirs with same repo-name prefix (same parent), SHORTEST basename = main.
  - **Young-worktree rule (R2)**: worktree age < `PIOPANET_PROTECT_DAYS` (default 3) → emit `protected:true` (same as main). Age = FIRST entry of the worktree's HEAD reflog (`<main>/.git/worktrees/<id>/logs/HEAD`, unix-ts field), fallback dir mtime. Sibling-clone lanes: age = dir mtime.
  - Single policy input: `signals.repo.protected` (bool) = `is_main_worktree || age < protect_days`. Keep `is_main_worktree` + new `age_days` fields for audit visibility.
- Verify: unit tests — `slack-configuration` → protected; `slack-configuration-wt` older than 3d → NOT protected; freshly created scratch worktree → protected; faked-clock tests for the 3d boundary (2d23h → protected, 3d1h → not).
- Acceptance: signals match user spec on fixtures + boundary tests green.

### S3 — Classifier: cover create+switch & detach (F3) · coder · 1–2h
- Action in `checkoutTarget.ts`: add `-b`,`-c` to create-and-switch detection → classify as `branch` (target = new name, i.e. deny by default in main dir unless allowlist). `origin/<x>` w/o local → `branch` name `<x>` (remote branch switch). `<sha>`/`--detach` → new kind `detached` — REGO denies in main dir (E5).
- Verify: unit tests per E3/E4/E5/E6 classification.
- Acceptance: classifier output matches matrix kinds.

### S4 — REGO: gate ALL branch-changing paths (F4) · coder · 1–2h
- Action `policy/safety.rego`: GROUP G extended —
  - deny `checkout|switch` target_kind ∈ {branch, detached} in PROTECTED dir (main OR young worktree per R2) (E1–E6);
  - deny `worktree add <path> <branch>` where branch ∉ allowlist AND path resolves OUTSIDE allowed wt dirs (E7);
  - deny `symbolic-ref HEAD <ref>` (E8) and `update-ref refs/heads/<x>` (E9) in protected dir;
  - swap `repo_available_main_worktree` predicate → `repo_available_protected` (reads `signals.repo.protected`);
  - new catalog rows in `src/rules/catalog.ts` (parity test enforces).
- Verify: `bun test tests/unit` + new rule fixtures E7–E9 + young/old worktree fixtures; parity test green.
- Acceptance: full E-matrix deny/allow asserted by tests incl. age-split.

### S5 — Allowlist = user spec (F5) · coder · 15min
- Action: default `allowed_branches` = `{dev, main, staging, test, stag, master}` in rego default AND `Config.ts` default; export `PIOPANET_ALLOWED_BRANCHES` for pi/hermes sessions (settings env path per repo deploy convention).
- Verify: eval `git checkout test` in main dir → allow.
- Acceptance: all 6 names allow.

### S6 — Deploy + live RED→GREEN proof · devops · 30–60min
- Action: publish/sync both roots (S1 path); run E-matrix LIVE in THREE fixtures: `slack-configuration` (main → 10 deny), `slack-configuration-wt` (old lane → 10 allow), and a FRESH worktree created at test time (young lane → 10 deny per R2).
- Verify: matrix output saved as evidence under this flow dir; verifier subagent re-runs matrix independently.
- Acceptance: 10/10 deny in main + young worktree, 10/10 allow in old worktree, no ajv error.

### S7 — Wire hermes-opa-net into Hermes profiles (F6) · devops · 1h
- Action: install `hermes-opa-net` (repo `packages/hermes-opa-net`, pre_tool_call hook) into profile configs — start with hermes-plan + coder as canary, then fleet per hermes-profile-sync-check skill (ask user about fleet-wide roll).
- Verify: from a Hermes session in a MAIN dir, `git checkout <feature>` tool call returns blocked-with-reason; lane worktree unaffected.
- Acceptance: canary profiles show live deny; no agent bricks on eval error (fail-open preserved except strict mode).

### S8 — Watchdog: reflog-based branch-drift monitor · devops · 1–2h
- Action: systemd timer (boot-safe per metal-ops wiring rule: `systemd-analyze verify` exit 0, NOT in boot-critical path, idle-priority, atomic swap) running a script that scans PROTECTED dirs' HEAD reflogs (MAIN dirs + worktrees younger than 3 days — recompute age each run) for branch moves off allowlist since last run (state file, incremental). Output → Slack #opa-net lane + append to `flow/findings/.../watchdog.log`. Gate is the wall; watchdog is the alarm when a new escape path appears.
- Verify: inject fake reflog entry in a scratch repo → alert fires; timer survives `systemctl daemon-reload` + reboot-safety check; root AGENTS.md of opa-net repo gets TOC line (metal-ops rule).
- Acceptance: alert round-trip proven E2E; zero false positives on 7-day historical reflogs (run script retroactively over past 7d first).

## Sequencing & lanes

| Lane | Steps | Owner | Parallel? |
|------|-------|-------|-----------|
| L1 engine repair | S1 → S6 | coder → devops | starts NOW (S1 independent) |
| L2 semantics | S2 ∥ S3 → S4 → S5 | coder | after S1 green (tests need engine) |
| L3 fleet wiring | S7 | devops | after S6 |
| L4 watchdog | S8 | devops | independent of S7; can start after S2 defines MAIN-dir list |

Critical path: S1 → S3 → S4 → S5 → S6 → S7 ≈ 4–7h.

## Effort & risk

- Total: ~5–8h coder+devops (R2 adds ~1h: age signal + boundary tests + third live fixture). Parallelizable: S2 ∥ S3; S4 depends on S3 kinds.
- Risks: (a) S2 sibling-prefix heuristic can misfire on unrelated repos sharing prefix — mitigated by same-parent-dir + prefix-with-separator match; (b) blocking `checkout -b` may annoy lane-work done in main dirs — that is the user's stated intent (work belongs in worktrees); (c) global CLI deploy may need npm publish per repo AGENTS.md — follow it; (d) R2 reflog-age signal: busy worktrees churn HEAD reflogs but FIRST entry is stable (creation) — age never inflates; dir-mtime fallback can UNDERSTATE age (touch) → conservative direction (protects longer), acceptable.
- Non-goals: gating in worktrees ≥3 days old; `git clone`; interactive UIs.

## Handoff

- Executor: h-bhd-main-coder (coder profile) for S1–S5; devops for S6–S8; verifier lane re-runs matrix + 7-day retro scan.
- This plan is input; findings doc carries evidence. Verbatim user gate spec lives in findings doc header.
- Live status: opa-net repo @ main (84b2ff5), working tree clean — safe to branch `wt/branch-gate-fix` for the work.
