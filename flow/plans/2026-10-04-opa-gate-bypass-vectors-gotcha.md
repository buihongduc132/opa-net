# Gotcha Coverage — 2026-10-04-opa-gate-bypass-vectors

> Source: flow/plans/2026-10-04-opa-gate-bypass-vectors.md
> Mode: plan
> Sub-agents: batch A (V1–V4) + batch B (V5–V7), 2 parallel leaf agents
> Units reviewed: (v1)…(v7) — all 7 declarative fix items

## Rank 5 (Sophisticated — invalidates the source approach)

- **G1 — V1 `/proc/$PPID/exe` parent check is vacuous; the guard gets silently deleted, not fixed**
  - What: the shim never persists as a process under `/opt/opa-gate/bin` — every path ends in `exec "$REAL_BIN"`, so no surviving process has exe under that prefix. The parent of any re-entrant shim is the real binary or the engine, never a shim. `readlink /proc/$PPID/exe` therefore never matches, and the recursion latch is effectively removed. The plan's DOD ("parent-is-shim re-entry still passes") is untestable — `sudo` re-entry already bypasses the guard via the L41 fast-path `unset`.
  - Mitigation: **drop the guard entirely** (near-vestigial: `:195` already unsets the sentinel before every allow-exec) **or** use a nonce passed via an inherited secret fd — not `/proc/$PPID`, not env, not a world-readable marker. State explicitly which and prove no flow regresses.

## Rank 4 (Significant — impacts correctness if unaddressed)

- **G2 — `OPA_GATE_INTERNAL` is produced in TWO files, seam list misses one** *(the env-dup class)*
  - What: `scripts/opa-gate-audit-append:4` also `export OPA_GATE_INTERNAL=1`; the plan pins only `.opa-gate-shim:11-24`. Rename/invert the sentinel and the stale producer is a latent bypass or breaks audit-append.
  - Mitigation: grep the whole repo for the sentinel in the DOD; fix both producers in lockstep.

- **G3 — V2 naive "replace subcommand with alias" breaks multi-word / shell aliases**
  - What: `alias.br='branch -m'`, `alias.x='!git checkout …'`, values with `;`/`&&`, alias chains (`a→b→checkout`) and self-cycles have no handling.
  - Mitigation: bounded-depth, cycle-detecting resolution; deny `!`-prefixed / control-operator aliases (fail-closed); re-split resolved multi-word values into subcommand+args.

- **G4 — V2 fail-closed "deny unknown git subcommand" is a large legit-flow regression**
  - What: denies `git lfs`/`git flow`/`git secret`/`git-crypt`/custom helpers and even bare `git`/`git --version` (subcommand `""`).
  - Mitigation: narrow fallback to "alias resolution failed AND token not a resolvable builtin/extension"; never blanket-deny unknown subcommands.

- **G5 — V2 alias resolution has no cwd in the proposed seam**
  - What: `ShellQuoteParser.classify` is string-only; resolution must run `git config --get alias.X` against the *effective* cwd (known only in `run.ts`, after `-C`/`gitCwd`/cd-tracking). Also global `~/.gitconfig` + system aliases missed.
  - Mitigation: resolve in `run.ts` after `effectiveCwd`, via `git -C <cwd> config --get`, cover global/system, keep `-c` > local > global precedence.

- **G6 — V3 gating depends on `PIOPANET_PROTECT_DAYS` read raw under TWO spellings, outside Config**
  - What: `RepoSignals.ts:207` reads `process.env.PIOPANET_PROTECT_DAYS || process.env.PIOPANET_WORKTREE_PROTECT_DAYS` directly; `Config.ts` has no accessor. The protected-vs-free boundary is exactly this value.
  - Mitigation: centralize to a single Config accessor + single spelling; pin the boundary in the DOD.

- **G7 — V4 not closed: `--git-dir`/`--work-tree`/`--namespace` are stripped-and-discarded**
  - What: same cwd/repo redirection bypass as `cd`; `git --work-tree=/repo checkout feature-evil` evals against the caller cwd → `repo.available=false` → allow.
  - Mitigation: propagate `--git-dir`/`--work-tree` into `effectiveCwd` (like `-C`), deny on unresolvable; add probes for both spellings.

- **G8 — V4 control-operator semantics lost; "unresolvable cd → deny" wrong for `||`/`;`**
  - What: `splitTopLevelSegments` drops the operator; `cd /x && git …` vs `cd /x || git …` vs `cd /x ; git …` all become the same segments. `||`/`;` run git in the ORIGINAL cwd on cd-failure; `&&` short-circuits. A blanket deny mis-models all three.
  - Mitigation: return operators; propagate cwd across `&&`/`;` with correct short-circuit, `||` falls back to unchanged cwd.

- **G9 — V5 naive `@` fix flips legit read-only `git symbolic-ref @` into deny** *(the "two spellings of HEAD" class)*
  - What: `symbolic_ref_mutates_head` spells HEAD four ways (guard ×3 + `other != "HEAD"` exclusion :888) + a fifth in `update_ref_targets_branch` :915. Changing only the guard to match `@` leaves the exclusion literal → `git symbolic-ref @` (non-flags `["@"]`) passes guard, `other := "@"` satisfies `other != "HEAD"` → deny on a read-only op, violating the plan's own DOD.
  - Mitigation: one `is_head_ref(arg)` = `"HEAD" | "@"` used in guard **and** `not is_head_ref(other)` (all clauses) + `update_ref_targets_branch`; add read-only `@`/`--short @` probes.

- **G10 — V7 reflog-watchdog mitigation self-undermining (un-gated `reflog`/`config`)**
  - What: watchdog substrate = `logs/HEAD` reflog; `git reflog expire --expire=now --all` / `git reflog delete` / `git config core.logAllRefUpdates false` erase it — and neither `reflog` nor `config` has a deny rule. `git reflog expire … && /usr/bin/git symbolic-ref @ refs/heads/evil` bypasses the gate AND blinds the detector.
  - Mitigation: deny `reflog expire/delete` + `core.logAllRefUpdates` toggling in protected worktrees, or make the watchdog tamper-evident; else document the residual as itself defeatable.

## Rank 3 (Moderate — needs explicit handling/docs)

- **G11 — `-c` capture spread across 3 branches + `--config-env`** (V2): centralize `-c`/`--config-env` value capture into `stripWithMeta` metadata like `cPath`, all 3 forms + `--config-env`.
- **G12 — alias resolution re-enters the shim** (V2): `resolveGitAlias` shelling to `git config` runs through `/opt/opa-gate/bin` on the direct-eval seam → recursion. Resolve via `/usr/bin/git` absolute path; bound depth.
- **G13 — unlock-key env 3 spellings** (V3/V6 test): shim reads `OPA_UNLOCK_KEY`/`OPA_UNLOCK_KEYS`/`PIOPANET_UNLOCK_KEYS`; Config reads only `PIOPANET_UNLOCK_KEYS`. Normalize to one; state which the override probe uses.
- **G14 — cd variants not handled** (V4): `(subshell)`, `pushd/popd` stack, `cd` (→ `$HOME`), `cd -`, `cd ~`, `FOO=bar cd`, chained `cd a && cd b`, `cd` in `bash -c` payloads. Maintain a cwd stack; resolve `$HOME`/`~`/`-`/no-arg; fail-closed only on genuinely unresolvable.
- **G15 — V6 DOD probes bare form, not the piped exploit** (V6): prove `printf 'update refs/heads/main <sha>' | git update-ref --stdin` flips GREEN on BOTH the shim and direct-eval seams.
- **G16 — V5 sufficiency: branch-ref symbolic mutation un-gated** (V5): `git symbolic-ref refs/heads/foo refs/heads/bar` and `-d refs/heads/foo` mutate branch refs; extend helper to `refs/heads*` or record as new residual.
- **G17 — `update-ref @ <sha>` not in matrix** (V5/V6): add it; implement `is_head_ref` from one shared definition.
- **G18 — other stdin mutators un-gated** (V6): `git fast-import` (`commit refs/heads/foo` directives), `filter-branch`/`filter-repo`. Fail-closed deny `fast-import` in protected worktrees or document as residual.
- **G19 — V5/V6 gate evadable via `--git-dir`/`--work-tree`** (V5/V6): same as G7; capture those globals into signal cwd or fail-closed when co-occurring with gated subcommand.
- **G20 — V7 cheap win missed: retire legacy `~/.local/bin/git`** (V7): the PATH-precedence half is a one-line config fix (symlink/delete/point at the shim). Keep only direct absolute-path exec as the true RED residual.

## Rank 2 (Minor — handled/trivial mitigation)

- **G21 — `git branch -m old new` two-arg + `-M` asymmetry** (V3): `current_branch` is collectable (plan's "unverifiable" rationale wrong); ensure `has_any_arg` catches `--move`; document the `-m`(gated)/`-M`(global) asymmetry deliberately.
- **G22 — V6 over-broadening on legit `update-ref --stdin` in young worktrees** (V6): inventory production hooks/sync scripts before shipping; document the unlock key.
- **G23 — shell `hash`/PATH caching** (V7): shells that hashed `/usr/bin/git` or `~/.local/bin/git` pre-install keep the stale path until `hash -r`; note in residual doc + health check `which git`.
- **G24 — `refs/heads` prefix lacks `/` boundary** (V5/V6): `startswith(arg,"refs/heads")` also matches `refs/headsfoo`; fix to `refs/heads/` when touching the helper for `@` parity.

## Cross-references

- G7 ↔ G19 (same `--git-dir`/`--work-tree` root cause across V4/V5/V6).
- G6 ↔ G13 (env-knob spelling drift: protect-days and unlock-keys both read raw outside Config).
- G9 ↔ G17 (one shared `is_head_ref` fixes both V5's guard/exclusion and V6's parity).
