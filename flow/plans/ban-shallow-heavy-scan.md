# Ban Shallow Heavy Scan

> Plan ID: `ban-shallow-heavy-scan`
> Created: 2026-09-09 · Last reconciled: 2026-09-09
> Working Status: done (2026-09-13 — verifier round-1 fixes applied; suite 764 pass / 0 fail)
> Deployment: dev:done (2026-09-13) - staging:not-in-goal-scope - prod:done (2026-09-13, ~/.pi/agent/npm/node_modules/pi-opa-net=0.7.0, probes in flow/findings/2026-09-13-dev-stage-deploy-proof/prod-deploy.md)
> Branch: test/bhd-195-red-home-wide-find-grep
> Location: flow/plans/ban-shallow-heavy-scan.md (committed 2373837)

## References
- Findings: `flow/findings/2026-09-09-ban-shallow-heavy-scan/`
- Source: current context (explore conversation, locked decisions LD1–LD4)

## Requirement (verbatim)
Resolved from current context (locked decisions LD1–LD4):

- LD1: "ban all kind of grep / find or any HEAVY cmd from root / and /<1lvl>/<2lvl>; Only be able to these kind of heavy cmd in level 3 and below."
- LD2: "make the message to instruct the agent to use eza to find out the directory first before actually doing the recursive search"
- LD3: "LIST all the cmd / tooling in the current machine , all of the one that could do heavy / saturate disk IO / cpu / ram must be BANNED"
- LD4: "For DU , depth 3"

## DOD (Definition of Done)
Plan done when ALL below true:
- [x] Heavy recursive cmd (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is denied.
- [x] Heavy recursive cmd at depth ≥3 is allowed.
- [x] `du` is allowed at depth 3.
- [x] `eza` remains allowed at shallow depth (discovery step, only with `-L N` N≤2 — see eza-level-gate).
- [x] Deny message instructs `eza -T -L 2 <dir>` first.
- [x] All IO/CPU/RAM-saturating tools (turn-2 list) enumerated in the rule. Covered: find/du/rg/fd/grep/egrep/rgrep/ls (scan class), fsck+baobab (added 2026-09-13, present on host), eza -T (level-gated). dd already guarded (of=/dev/*); cp/mv/rm/tree-ops + piped sort/wc/cat/xargs are covered transitively (scan segment deny blocks the compound; every segment evaluated). Absent binaries (ncdu/tree/ag/ack/bfs/locate/updatedb/dust/dua/gdu/duf/ddrescue/btrfs/zfs) need no rule (turn-2 probe).

## Tasks

### Rego policy (policy/safety.rego)
- [x] scan-programs-set: `scan_programs` set defined = {find, du, rg, fd} always-heavy, plus flag-gated {grep, egrep, rgrep, ls} (recursive flag required).
- [x] path-depth-predicate: `path_depth(p)` = count of non-empty `split(p, "/")` segments; `shallow(p)` = absolute path AND depth <= 2.
- [x] shallow-scan-deny: deny rule fires for scan-program + shallow path + not(under eval_cwd / known-goal / cwd-relative).
- [x] du-depth3: `du` allowed at depth >= 3 (LD4).
- [x] eza-allow: `eza` exempt from the ban (discovery allow-class).
- [x] message-eza-first: deny message = "Recursive scan (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is blocked — full-tree IO saturates the disk and hangs. Discover first with `eza -T -L 2 <dir>`, then scan a specific ≥3-level target (e.g. `/var/lib/docker`, `/home/bhd/.local`). Unlock: `block-shallow-heavy-scan`."

### TS catalog + registry (src/rules/)
- [x] rulefamily-scan: `RuleRegistry.ts` `RuleFamily` union extended with scan families (`du`, `rg`, `fd`).
- [x] catalog-parity-entries: `catalog.ts` adds a `RuleMeta` entry per new deny message (message-for-message parity with rego).
- [x] unlock-key: unlock key `block-shallow-heavy-scan` recognized by the unlock system.

### Tests
- [x] parity-test-green: `rule-catalog-parity.test.ts` passes (rego ↔ catalog aligned).
- [x] deny-shallow-tests: unit tests assert depth 0/1/2 denied, depth ≥3 allowed, `du` depth-3 allowed, `eza` exempt, cwd-relative exempt.

## Idempotency
Re-running `/10-plan-declarative` on same requirement reconciles to THIS plan.
Implemented items auto-marked `- [x]`. Pending items surface as work-remaining.
DO NOT rewrite item prose on re-run (status flips only).

## Gotcha-driven items (appended by /gotcha-coverage)

- [x] path-normalize: normalize `.`/`..`/`//`/trailing-`/` before depth count. Status: done (fixture case du-dotdot). Probe `du -sh /var/lib/..` → denied.
- [x] raw-token-fallback: raw-token deny rule for `~`/`$HOME`/`${HOME}`/empty-arg/compound (GROUP K `find_raw_home_token` pattern). Probe: `du -sh $HOME` → denied.
- [x] recursive-by-default: `rg`/`fd`/`rgrep` classified always-heavy (not flag-gated). Probe: `rg x /` → denied.
- [x] cwd-resolution: relative `.` path resolved against cwd signal; deny if resolved depth ≤2. Probe: `cd / && du -sh .` → denied. RESOLVED (OT6, 2026-09-13): allow-all-relative chosen — agent cwd is a repo/dir in practice and the incident commands were all absolute paths; `du -sh .` in a repo must stay usable.
- [x] eza-level-gate: `eza` exempt only when `-L N` (N≤2) present. Probe: `eza -T /` → denied; `eza -T -L 2 /` → allowed. IMPLEMENTED 2026-09-13: numeric N parsed from -L N/-LN/--level=N/--level N; bounded iff max(N)≤2 (`eza -T -L 99 /` denies).
- [x] depth-cap-exempt: exempt `du -d` / `find -maxdepth` / `rg --max-depth` ≤2. Probe: `du -d 1 /` → allowed. IMPLEMENTED 2026-09-13 per OT7 resolution: find -maxdepth N|-maxdepth=N and rg --max-depth N|--maxdepth=N exempt at N≤2 (descent-pruning). du -d N NOT exempt — du does not prune traversal (turn-1 incident was exactly `du -xh -d1 /`).
- [x] wrapper-unwrap: `sudo`/`env`/`nice`/`nohup`/`time` unwrap before `program_base`. Probe: `sudo du -sh /` → denied. IMPLEMENTED 2026-09-13: parser-level unwrapWrapperTokens (sudo/env/nice/nohup/time/timeout/stdbuf/ionice + value flags + env VAR= + timeout duration). `sudo du -sh /var` → deny as du.
- [x] pattern-vs-path: per-program path extraction (`rg`/`grep`/`fd` skip pattern positional). Probe: `rg '^/$'` → not false-deny.
- [x] groupk-overlap: GROUP K ∩ GROUP L precedence + overlap tests. Probe: `find /home/bhd` → single clear message.
- [x] behavioral-tests: behavioral deny/allow fixture matrix + unlock e2e. Probe: `bun test tests/e2e/unlock-flow.test.ts` green.

## Gotcha Coverage
- Appendix: `flow/plans/ban-shallow-heavy-scan-gotcha.md` (25 deduped gotchas, ranked).
- Items revised by gotchas: `scan-programs-set` (G5.2), `path-depth-predicate` (G5.1/G5.4), `du-depth3` (G2.3 → test-only), `eza-allow` (G4.1 → level-gated).

## Open Threads
- OT1: RESOLVED — ≥3 (LD4). du depth semantics — exactly 3 vs ≥3 (interpreted ≥3, LD4).
- OT3: guard must live at agent tool-call path (opa-net hook), not shell.
- OT5: RESOLVED 2026-09-13 — descent-pruning flags only (find/rg maxdepth ≤2 exempt); du -d not a bound (see depth-cap-exempt). G5.3 — is path-depth the right IO proxy for `du`, or gate on depth-cap flags? (decision gate before implementation)
- OT6: RESOLVED 2026-09-13 — allow-all-relative (see cwd-resolution note). G5.4/G4.2 — relative-path + cwd resolution policy (deny-at-shallow-cwd vs allow-all-relative). (decision gate)
- OT7: RESOLVED 2026-09-13 — du stays banned with -d; find/rg maxdepth ≤2 exempt (see depth-cap-exempt note). G4.5/G5.3 — exempt `du -d1 /` (bounded report) or keep banned (still walks full tree)? (decision gate)
