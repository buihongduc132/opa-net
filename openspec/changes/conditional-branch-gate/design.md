## Context

pi-opa-net v0.1.0 evaluates a parsed command struct (`{program, subcommand, args, raw}`) against `policy/safety.rego` and emits a `decision-output.v1` record. The input is **command tokens only** — there is no repo/environment context. This makes every rule inherently unconditional (token-in-set), which is exactly the wall the cc-safety-net fork (`pi-safety-net`, Path A) hit when asked to block branch-switching off protected branches.

Cupcake (eqtylab/cupcake) solves this with a "signals" mechanism: arbitrary shell-collected values surfaced as `input.signals.*` so Rego can write conditional rules. That mechanism is the one feature gap between pi-opa-net and Cupcake (see OT5 + the proposal). Resolving it in pi-opa-net (rather than adopting Cupcake wholesale) preserves ownership of the `decision-output.v1` schema, the locked LD1 engine choice, and the LD5 exit-code contract.

The locked decisions constraining this design: LD1 (OPA/Rego engine), LD2 (OPA on-box lazy-loaded), LD3 (bash-guard scope — still respected: we guard the `git` **command**, just with more input), LD4 (`--json` is output-only; input stays Rego — the signals become a Rego input, not a JSON-side feature), LD5 (schema v1 + exit codes unchanged).

Current relevant code:
- `policy/safety.rego` — `package safety`, `default allow := true`, `input = {program, subcommand, args, raw}`.
- `src/evaluator/` — wires parser → engine → builder (empty dir at v0.1.0; orchestration lives in `src/cli/run.ts` + `src/index.ts`).
- `src/config/Config.ts` — `EngineConfig`, env resolution (`configFromEnv`).
- `schemas/decision-output.v1.json` — the symmetric decision record.
- `src/cli/run.ts` — CLI entry (`eval <cmd>`).

## Goals / Non-Goals

**Goals:**
- Introduce `input.signals` as a first-class OPA input so policies can be conditional on repo/environment context.
- Ship three signal families in v1 (`git.*`, `repo.*`, `worktree.*`) plus `env.home`, enough to block branch-switching to non-allowlisted branches AND `git worktree add` outside approved dirs.
- Keep the change additive: no break to schema v1, exit codes, fail-mode, or the Claude Code hook protocol.
- Make future signals a config-only addition (new collector module + Rego rule), not a pipeline rewrite.
- Stay dependency-free for the collector (Node `execFileSync` + `fs.realpathSync`, already established patterns).
- Close CVE-class bypass paths (path traversal, symlink escape, git global option injection, checkout disambiguation) via mandatory hardening (LD6–LD8).

**Non-Goals:**
- No boolean policy DSL beyond what Rego already provides.
- No broad `env.*` value gating in v1 — only `env.home` for tilde expansion of allowed-prefix paths (OT2 amended).
- No pi-extension caller identification (LD4: rules fire for ALL callers; OT16 tracks unlock-key friction).
- No changes to the `pi-safety-net` fork (Path A stays token-only).
- No `gh repo clone` / `gh repo sync` path-discipline (LD5 scopes to `git worktree` only; OT7 tracks as future work).

## Decisions

### D1 — Signals live in the Rego `input`, not a parallel channel
**Choice:** Collect signals before evaluation and merge them into the existing `input` object as `input.signals.*`. The CLI/evaluator still calls OPA once.

**Why:** LD4 locks `--json` as output-only and input as Rego-native. A parallel channel (e.g. a sidecar side-input) would double the OPA call surface and break the single-decision-record contract. Cupcake converges on the same shape (`input.signals.*`), so this is also reference-implementation parity.

**Alternatives rejected:**
- *Signals as Rego `data`* — `data` is meant for policy/config bundles, not per-invocation runtime facts; would require a data write per call.
- *Env-only context (no signal abstraction)* — hard-codes `git branch` detection and re-creates the wall for the next signal.

### D2 — Signal collection is a pluggable layer, not embedded in the evaluator
**Choice:** New `src/signals/` module. `SignalCollector` interface: `collect(context: { cwd: string; raw: string; parsed: ParsedCommand }): Signals`. One concrete impl: `GitSignals`. The evaluator calls `collectAll(collectors, context)` (array) and merges results.

**Why:** Keeps the "future signals = new collector module + Rego rule" promise. Evaluator stays policy-agnostic. Mirrors the parser-coordinator strategy already used (`CommandParserCoordinator`).

**Alternatives rejected:**
- *Single function in evaluator* — fails the pluggability goal; the next signal rewrites the evaluator.
- *Convention-based auto-discovery of collector files* — premature; explicit array is enough for one collector.

### D3 — `GitSignals` uses `execFileSync('git', [...], {cwd})`, fail-open
**Choice:** `current_branch` via `git rev-parse --abbrev-ref HEAD` run with the command's cwd. On any error (non-repo, detached HEAD, git missing, non-zero exit) the collector returns `{ current_branch: null, available: false }` and the branch-protection rule **skips** (treats as allow). `target_branch` is parsed from the command args (`checkout`/`switch <branch>`), no git call.

**Why:** Matches the existing `execFileSync(git, ..., {cwd})` helper pattern from cc-safety-net's `src/core/git/config.ts` (cited in research). Fail-open matches LD2/OT2's "never brick the shell" guarantee — a missing git must not turn the guard into a blocker.

**Alternatives rejected:**
- *fail-closed on git error* — would brick the shell on machines without git or in non-repo dirs; violates the fork's core guarantee.
- *Read `.git/HEAD` directly* — fragile across packed refs / worktrees; `git rev-parse` is the stable contract.

### D4 — Protected-branch set is configurable, default 5, empty disables
**Choice:** `Config.protectedBranches: string[]` from `PIOPANET_PROTECTED_BRANCHES` (comma-separated). Default: `["main","staging","dev","test","master"]`. Passed to Rego as `data.config.protected_branches`. An empty array ⇒ the branch-protection rule matches nothing ⇒ effectively disabled.

**Why:** Policy authors must be able to scope this per repo (some teams protect `develop`, others `trunk`). Empty-means-off gives a clean kill-switch without code changes.

**Alternatives rejected:**
- *Hardcode in Rego* — re-deploy the policy to change one branch name; bad ergonomics.
- *Separate config file* — adds a file-format dependency; env+data.config is already the established config surface.

### D5 — Schema gets additive `signals` field, stays v1
**Choice:** Add optional `decision.signals?: { git?: { current_branch: string|null; target_branch: string|null; available: boolean } }` to `decision-output.v1.json`. No version bump. Existing consumers ignore unknown fields.

**Why:** Provenance — every decision record shows which signals fired and their values, so a deny can be traced to "current_branch=main". Additive ⇒ non-breaking (LD5's symmetric-output contract holds). A v2 is unjustified: no field removed, no semantic change.

**Alternatives rejected:**
- *No signals on the decision record* — loses provenance; the whole point of this repo's symmetric schema is traceability.
- *Bump to v2* — LD5 locks v1; v2 is reserved for breaking changes.

### D6 — Path canonicalization pre-rego (LD6)
**Choice:** TS-side `fs.realpathSync()` runs on both the target path AND every allowed-prefix BEFORE Rego sees them. Reject if realpath fails, if resolved path contains `..` segments, or if target basename is `.git`. Rego prefix match uses `startswith(resolved, allowed + path.sep)` to enforce boundary.

**Why:** Rego has no filesystem access — cannot resolve symlinks or `..`. The security boundary MUST be enforced in TS before Rego receives the data. SEI CERT FIO02-A, OWASP Path Traversal, CVE-2026-55607, CVE-2024-32002 all confirm: naive `startswith` prefix match is defeated by symlinks and `..` traversal.

**Alternatives rejected:**
- *Rego-side string normalization* — rego has no filesystem access; cannot resolve symlinks.
- *Reject-only without realpath* — cannot detect symlink escapes; `..` traversal trivially bypasses.

### D7 — Checkout/switch target disambiguation (LD7)
**Choice:** Detect `--` in args → pathspec form → skip branch rules entirely. Classify target via `git rev-parse --verify refs/heads/<X>` — if not a local branch ref → skip rule (commit-ish/tag/remote-tracking). Handle `--detach`/`-d` as detached-HEAD intent. Handle `-` (previous) via `git rev-parse @{-1}`. Normalize `origin/feature` → strip remote prefix for allowlist lookup.

**Why:** `git checkout` has two distinct semantics: branch switch vs file restore. Without disambiguation, `git checkout feature -- file.ts` (file restore) would be misclassified as a branch switch. `git(1)` ARGUMENT DISAMBIGUATION section and builtin/checkout.c `parse_branchname_arg` (4 cases) confirm the classification logic.

**Alternatives rejected:**
- *Regex-only classification* — too many false positives (commit-ish, remote-tracking, file restores).
- *Skip checkout entirely, only gate switch* — LD1 user-locked to include checkout.

### D8 — Git global option stripping (LD8)
**Choice:** Add `stripGitGlobalOptions(args[])` pre-pass in `ShellQuoteParser.classify()` when `program === "git"`. Strip known globals before subcommand classification: `-C <path>`, `-c <name>=<value>`, `--git-dir=<path>`, `--work-tree=<path>`, `--namespace=<name>`, `--exec-path=<path>`, `-p`, `-P`, `--no-replace-objects`, `--no-lazy-fetch`, `--no-advice`, `--bare`, `--paginate`, `--no-pager`, `--help`, `--version`, `--html-path`, `--man-path`, `--info-path`. Handle both space-separated and `=`-joined forms.

**Why:** Without stripping, `git -C /evil worktree add foo` produces `subcommand=""` (because `rest[0].startsWith('-')`) → all rules defeated. `git(1)` SYNOPSIS (global options before command) and `git.c handle_options()` (canonical dispatch) confirm the parsing contract.

**Alternatives rejected:**
- *Regex-based subcommand extraction from raw string* — same maintenance burden, less reliable.
- *fail-closed on unrecognized leading dash* — breaks legitimate git usage.

### D9 — `is_main_worktree` detection via `git rev-parse` (LD4)
**Choice:** `signals.repo.is_main_worktree` compares `git rev-parse --git-dir` vs `git rev-parse --git-common-dir`. If they differ → linked worktree (sub-worktree) → rule skips. If same → main worktree → rule fires. Fail-open on errors.

**Why:** `stat <cwd>/.git` is unreliable: submodules have `.git` as FILE (gitdir: .../modules/...) → misclassified as "not main worktree" → silent bypass. `git rev-parse --git-dir` vs `--git-common-dir` is the stable contract.

**Alternatives rejected:**
- *stat-based detection* — fragile across submodules, packed refs, worktrees.
- *Always-fire (no is_main_worktree check)* — contradicts LD4 "sub-worktrees roam free" guarantee.

## Risks / Trade-offs

- **[Risk] git call latency on every guarded command** → git signals only shell out when `parsed.program === "git"` and subcommand is relevant (checkout/switch/worktree). Non-git commands skip collection entirely. Batch: `git rev-parse --abbrev-ref HEAD --show-toplevel --git-common-dir` in one call. Short TTL cache. Lazy collection.
- **[Risk] Signal collection throws and aborts evaluation** → every collector is wrapped; any throw ⇒ that signal is `{available:false}`, never aborts the decision. Covered by OT2's fail-open posture at the engine layer as backstop.
- **[Risk] `target_branch` misparsed** (e.g. `git checkout -b new`, `git switch -`) → LD7 disambiguation resolves via `git rev-parse --verify refs/heads/<X>`. When ambiguous, `target_branch` is `null` and the rule skips (fail-open).
- **[Risk] Cross-platform git path** → `execFileSync` resolves `git` from PATH; on boxes where git isn't on PATH the collector fails open. Documented prerequisite (git is already required for any `git checkout` to work anyway).
- **[Risk] Path traversal bypass** → LD6 mandatory canonicalization closes CVE-class bypass. `fs.realpathSync()` + `..` rejection + `.git` basename rejection + boundary-enforced prefix match.
- **[Risk] Git global option bypass** → LD8 mandatory stripping closes `-C /evil` bypass. Pre-pass runs before subcommand classification.
- **[Trade-off] We carry the signals design ourselves vs adopt Cupcake** → accepted. Ownership of the schema + LD1 is the explicit reason. Documented as the strategic alternative in the proposal; this design makes Cupcake a reference, not a dependency.
- **[Trade-off] Branch-protection is opinionated** → mitigated by D4 (configurable + empty-disables). The default set is the most common convention, not a mandate.
- **[Trade-off] Worktree-path-allowlist is opinionated** → mitigated by LD3 (configurable + empty-disables). Default prefixes cover the two most common conventions (`.worktrees/`, `worktrees/`) plus the superpowers convention.

## Migration Plan

1. **Implement** `src/signals/` (GitSignals, RepoSignals, WorktreeSignals, EnvSignals), `src/parser/stripGitGlobalOptions.ts`, `src/parser/checkoutTarget.ts`, `src/util/canonicalizePath.ts`, wire evaluator, extend rego + schema + config (see tasks.md).
2. **Test** — new e2e fixtures: branch-target-allowlist (deny from main worktree; allow from sub-worktree; config override); worktree-path-allowlist (deny `/tmp/evil`; deny symlink escape; deny `git -C /evil worktree add`; allow `.worktrees/feat`); checkout disambiguation (file restore → allow; detached HEAD → skip; commit-ish → skip); global option stripping (each global option stripped correctly).
3. **Audit** — E2E tests write decision records to `.pi-opa-net/audit/<decision-id>.jsonl` for third-party verification.
4. **No data/behavior migration** — additive; existing decisions are unchanged (no `signals` field ⇒ consumers treat as absent).
5. **Rollout** — ship as a minor bump (0.1.x → 0.2.0). New rules are ON by default; repos that want them off set env vars to empty.
6. **Rollback** — revert to prior tag; no persisted state to clean up (signals are per-invocation, never written).
7. **Doc update** — README capabilities + `docs/signals.md`; update OT4/OT5 notes to record that the signals gap is now closed.

## Open Questions

- **OQ1:** Should `current_branch` be cached across rapid successive calls within one session? Defer — add only if a profiled hot path shows measurable cost. (Default: no cache; correctness over speed.)
- **OQ2:** Should the rule also guard `git restore --source=<branch>` and `git reset --hard <branch>`? **Out of scope for v1** — those don't *switch* the branch; only `checkout`/`switch` change `HEAD`. Can be a follow-up rule reusing the same signal.
- **OQ3:** Naming — `signals.git.target_branch` vs deriving a normalized "switch intent". v1 keeps the raw parsed token; normalization is a parser concern (OT1 territory), deferred.
