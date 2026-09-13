## Why

pi-opa-net's policy input today is command tokens only — it cannot see the repo's current branch, working directory, or environment, so it cannot express conditional rules like "block `git checkout`/`switch` away from a protected branch" or "block `git worktree add` outside skill-approved directories". This is the second time the schema wall has surfaced (cc-safety-net hit the same limit). The same architecture that makes this impossible for cc-safety-net (token-only Set equality) is fixable here by adding a context/signals input to OPA, borrowing Cupcake's "signals" design. Resolving it now lets every future context-dependent policy come for free and answers OT4's fork-retirement question cleanly.

The original change introduced `git.current_branch` + `branch-protection`. **This extension adds three more families** (target allowlist, worktree-path allowlist, repo/worktree signals) plus **mandatory security hardening** (path canonicalization, checkout disambiguation, git global option stripping) that close CVE-class bypass paths.

## What Changes

### Original (already in proposal — preserved)
- **Add a context/signals input** to the OPA evaluation: `input.signals.*`, sourced from a pluggable signal collector. v1 ships the `git.*` family: `git.current_branch`, `git.target_branch`.
- **Add a `branch-protection` Rego rule** that denies `git checkout`/`git switch` when `signals.git.current_branch` is in a configurable protected set AND the target is a different branch. Default protected set: `main`, `staging`, `dev`, `test`, `master`.
- **Extend the decision-output.v1 schema** with an optional `signals` object on the decision record (additive, non-breaking).
- **Add a signal-collection layer** (`src/signals/`) with one concrete collector (`GitSignals`). Fail-open on git errors.
- **Make the protected-branch set configurable** via env (`PIOPANET_PROTECTED_BRANCHES`) and rego `data.config`, defaulting to the 5-branch list. Empty set disables the rule.

### Extension (this round — gated by LD1–LD8)
- **Add `branch-target-allowlist` Rego rule** (Req A, LD1): denies `git checkout`/`git switch <X>` when `<X>` resolves to a local branch ref AND `<X>` is not in the configurable `PIOPANET_ALLOWED_BRANCHES` set. Default set: `dev,staging,main,master`. **Only fires from the main worktree** (sub-worktrees roam free). Empty set disables.
- **Add `worktree-path-allowlist` Rego rule** (Req B, LD5): denies `git worktree add|move|repair <path>` when the canonicalized path is not under one of the configurable `PIOPANET_WORKTREE_ALLOWED_DIRS` prefixes. Default prefixes: `.worktrees`, `worktrees`, `~/.config/superpowers/worktrees`. Empty set disables. `gh repo clone` is explicitly out of scope.
- **Add three new signal families** (`repo.*`, `worktree.*`, `env.home`) sourced from new collectors. `signals.repo.is_main_worktree` distinguishes parent from sub-worktree (LD4). `signals.env.home` enables tilde-expansion in path prefixes (OT17 cross-platform).
- **Path canonicalization (LD6)**: TS-side `fs.realpathSync()` runs on both the target path AND every allowed-prefix BEFORE Rego sees them. Rejects realpath failure, `..` traversal, symlink escape, and `.git`-named targets.
- **Checkout/switch target disambiguation (LD7)**: detect `--` separator (pathspec form → skip branch rules), resolve target via `git rev-parse --verify refs/heads/<X>`, normalize `origin/feature` (strip remote), and handle `--detach`/`-` correctly.
- **Git global option stripping (LD8)**: `stripGitGlobalOptions(args[])` pre-pass strips `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`, `-p`, `-P`, `--bare`, `--paginate`, `--no-pager`, `--no-replace-objects`, `--no-lazy-fetch`, `--no-advice` before subcommand classification. Handles both space-separated and `=`-joined forms.
- **No changes to fail-mode, exit codes, or the Claude Code hook protocol.** All new rules are deny rules that emit the existing deny JSON shape.

**Non-goals (v1):**
- No multi-signal boolean policy language beyond what Rego already provides.
- ~~No `env.*` value rules (env is collected but not gated on yet).~~ **AMENDED (OT2):** `env.home` IS now gated on for tilde expansion of allowed-prefix paths (Req B). This is the single permitted env-value use; no broader `env.*` gating in v1.
- ~~No pi extension wiring (still OT5, separate `pi-opa-net-ext` repo).~~ **AMENDED:** pi extension is wired (pi-opa-net is the pi extension); still no per-call caller identification.
- No `signals.caller.*` in v1 (LD4: both new rules fire for ALL callers — parent + subagent).
- Does NOT touch the cc-safety-net fork (`pi-safety-net`, Path A) — that fork stays token-only.
- No `gh repo clone` / `gh repo sync` path-discipline (LD5 scopes to `git worktree` only; OT7 tracks as future work).

## Capabilities

### New Capabilities
- `context-signals`: Pluggable signal-collection layer that enriches the OPA `input` with repo/environment context (`signals.git.*`, `signals.repo.*`, `signals.worktree.*`, `signals.env.home`) before evaluation. Fail-open on collection errors.
- `branch-protection`: Conditional policy rule that denies branch-switching **away from** protected branches, sourced from `signals.git.*` + a configurable protected set. (Original.)
- `branch-target-allowlist`: Conditional policy rule that denies branch-switching **to** non-allowlisted branches, sourced from `signals.repo.is_main_worktree` + `signals.git.target_branch` + a configurable allowed set (LD1).
- `worktree-path-allowlist`: Conditional policy rule that denies `git worktree add|move|repair` outside allowed path prefixes, sourced from `signals.worktree.target_path` + a configurable prefix set, with mandatory path canonicalization (LD6).

### Modified Capabilities
<!-- openspec/specs/ is empty (fresh project) — no existing capabilities to modify. -->
_(none — this is the first spec introduced for pi-opa-net)_

## Impact

- **Code:**
  - new `src/signals/` module (`GitSignals.ts`, `RepoSignals.ts`, `WorktreeSignals.ts`, `EnvSignals.ts` + types + `collectAll.ts` + `index.ts`);
  - new `src/parser/stripGitGlobalOptions.ts` (LD8 pre-pass, called from `ShellQuoteParser.classify()` when `program === "git"`);
  - new `src/parser/checkoutTarget.ts` (LD7 disambiguation, called from `GitSignals` to compute `target_branch`); 
  - new `src/util/canonicalizePath.ts` (LD6 `realpathSync` + `..`/`.git`/symlink rejection);
  - edits to `src/cli/run.ts` (collect signals → inject into OPA input), `policy/safety.rego` (3 new rules + `data.config.allowed_branches`, `data.config.worktree_allowed_dirs`), `src/config/Config.ts` (parse `PIOPANET_ALLOWED_BRANCHES` + `PIOPANET_WORKTREE_ALLOWED_DIRS`), `src/parser/ShellQuoteParser.ts` (call `stripGitGlobalOptions`).
- **Schema:** `schemas/decision-output.v1.json` gains optional `signals` field (additive, non-breaking). Bump schema description; keep `v1` marker (no v2).
- **API:** `CommandParserCoordinator` consumers unaffected; new public exports: `GitSignals`, `RepoSignals`, `WorktreeSignals`, `EnvSignals`, `stripGitGlobalOptions`, `classifyCheckoutTarget`, `canonicalizePath`. CLI gains no new flags (signals auto-collected when cwd present).
- **Dependencies:** none new (uses Node `execFileSync` + `fs.realpathSync`, already established patterns).
- **Tests:** new e2e for each new rule (allow-list deny from main worktree; sub-worktree exempt; `git worktree add /tmp/evil` deny; symlink escape deny; `git -C /evil worktree add` deny after global strip; `git checkout feature -- file.ts` allow as file restore); unit tests for every new module (RED → GREEN separate commits per LD + worst-first-testing).
- **Audit:** E2E tests write auditable decision records to `.pi-opa-net/audit/<decision-id>.jsonl` so a third party can `cat` the file and see real eval output (not prose).
- **Docs:** README "Capabilities" + `docs/signals.md` describing the signals input contract for future policy authors.
- **Tracked threads:** directly advances OT4 (signals design was the gap pi-opa-net had vs Cupcake); resolves OT10 (path traversal → LD6), OT11 (checkout ambiguity → LD7), OT12 (global option bypass → LD8), OT15 (worktree move evasion → rule gates move/repair), OT17 (HOME undefined → `os.homedir()` cross-platform), OT19 (trailing comma → split-filter). LD1–LD5 reflected in proposal text. OT2 (non-goal drift) resolved by amendment above.
