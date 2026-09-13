## 1. Signal collection layer

- [ ] 1.1 Define `SignalCollector` interface and `Signals` / `GitSignal` types in `src/signals/types.ts`.
- [ ] 1.2 Implement `GitSignals` collector (`src/signals/GitSignals.ts`) that shells `git rev-parse --abbrev-ref HEAD` with the provided `cwd` and returns `{ current_branch, available }`. Fail-open: catch errors and return `{ current_branch: null, available: false }`.
- [ ] 1.3 Implement `collectAll(collectors, context)` helper in `src/signals/collectAll.ts` that runs collectors in parallel and merges outputs, suppressing any thrown errors.
- [ ] 1.4 Add `src/signals/index.ts` exporting `SignalCollector`, `GitSignals`, `collectAll`, and the signal types.
- [ ] 1.5 Add unit tests for `GitSignals` using a temp git fixture repo and a non-repo fixture; cover success, detached HEAD, non-repo, and git-missing paths.

## 2. Configuration and target-branch parsing

- [ ] 2.1 Extend `EngineConfig` in `src/config/Config.ts` with `protectedBranches?: string[]`.
- [ ] 2.2 Add `parseProtectedBranches(envValue?: string): string[]` in `src/config/Config.ts` that defaults to `["main","staging","dev","test","master"]` and treats an empty string as `[]`.
- [ ] 2.3 Update `configFromEnv` to read `PIOPANET_PROTECTED_BRANCHES` and pass it into `EngineConfig`.
- [ ] 2.4 Add utility `parseGitTargetBranch(subcommand: string, args: string[]): string | null` in `src/signals/GitSignals.ts` or `src/parser/` to extract the target branch from `git checkout <branch>` / `git switch <branch>` while ignoring flags (`-b`, `-`, `-f`, `--track`, etc.).
- [ ] 2.5 Unit tests for `parseGitTargetBranch` covering bare branch, flags, commit-ish, `-`, and missing target.

## 3. Rego policy and OPA input

- [ ] 3.1 Update `policy/safety.rego` input contract comment to include `signals: { git: { current_branch: string|null, target_branch: string|null, available: bool } }`.
- [ ] 3.2 Add `default allow := true` + `data.config.protected_branches` usage to the Rego policy; add a `branch_protection_checkout` rule that denies when `signals.git.available`, `current_branch` is in `protected_branches`, `target_branch` is non-null, and `target_branch != current_branch`.
- [ ] 3.3 Add `branch_protection_switch` rule with identical logic for `git switch`.
- [ ] 3.4 Update `OpaCliEngine` / evaluator (`src/engine/OpaCliEngine.ts` and `src/evaluator/` if present) so that OPA is invoked with a `data` bundle containing `config.protected_branches` when provided.
- [ ] 3.5 Wire the OPA input in the CLI path so that `input.signals` is present when `GitSignals` is active.

## 4. Evaluator and CLI wiring

- [ ] 4.1 Refactor the CLI evaluation flow (`src/cli/run.ts`) to instantiate `GitSignals` and `collectAll` before calling the engine, merging `signals` into the OPA input.
- [ ] 4.2 Update `CommandParserCoordinator` (or the evaluator) to pass the command's `cwd` (from `process.cwd()` or a `--cwd` flag) into the signal collection context.
- [ ] 4.3 Ensure `GitSignals` is only invoked when `parsed.program === "git"` and `subcommand` is `checkout` or `switch` (to avoid unnecessary git calls for unrelated commands).
- [ ] 4.4 Add a `signals` argument to the programmatic API entry point (or thread it via `DecisionContext`) so consumers can supply pre-computed signals if desired.

## 5. Decision-output schema and provenance

- [ ] 5.1 Add optional `signals` object to `schemas/decision-output.v1.json` matching the Git signal shape; update description and examples.
- [ ] 5.2 Update `DecisionBuilder` in `src/output/DecisionBuilder.ts` to accept signals and include them in the final decision record under `signals`.
- [ ] 5.3 Update `OpaCliEngine` / evaluator to carry the collected signals through to the `DecisionBuilder`.
- [ ] 5.4 Add test that validates a deny decision record against the updated JSON schema, ensuring `signals.git.current_branch` appears in the denied output.

## 6. Tests and fixtures

- [ ] 6.1 Create e2e test fixture repos: one on `main`, one on `feature`, one on `staging`, one on a detached HEAD.
- [ ] 6.2 Write e2e tests for `git checkout feature` from `main` → deny, from `feature` → allow, from `staging` → deny, and detached HEAD → allow.
- [ ] 6.3 Write e2e test for `PIOPANET_PROTECTED_BRANCHES=""` → rule disabled and `PIOPANET_PROTECTED_BRANCHES="trunk,develop"` → custom branches.
- [ ] 6.4 Write e2e test for non-git command (`docker stop foo`) to ensure no `signals.git` present and evaluation still works.
- [ ] 6.5 Write test for fail-open: corrupted `git` binary / non-repo → `signals.git.available = false`, decision still emitted as `allow` for an otherwise safe command.
- [ ] 6.6 Run the full test suite (`bun test` or equivalent) and ensure no regressions.

## 7. Documentation and thread updates

- [ ] 7.1 Add `docs/signals.md` documenting the `input.signals` contract, the Git signal fields, and how to add a new signal in the future.
- [ ] 7.2 Update README.md "Capabilities" section to mention context-aware branch protection.
- [ ] 7.3 Update `docs/open-threads.yaml` OT5 to note that the context/signals design gap has been resolved; update OT4 if needed to reflect that the Path B (OPA) engine now matches the Cupcake-style signal capability.
- [ ] 7.4 Add an example in `policy/safety.rego` header or `docs/signals.md` showing the protected-branch rule.
- [ ] 7.5 Update CHANGELOG.md with the new feature entry (minor bump).

## 8. Verification and final checks

- [ ] 8.1 Run lint (`bun run lint` or `biome check`) and fix any formatting issues.
- [ ] 8.2 Run typecheck (`tsc --noEmit` or `bun run typecheck`).
- [ ] 8.3 Run the full test suite and confirm 100% of existing tests still pass, plus new tests.
- [ ] 8.4 Validate `decision-output.v1.json` against its own meta-schema and sample decision records.
- [ ] 8.5 Inspect `git status` and ensure only intended files are changed (no accidental `node_modules` or unrelated edits).
- [ ] 8.6 Open `/opsx-apply` and implement the change.

## 9. Parser hardening — git global option stripping (LD8)

- [ ] 9.1 Implement `stripGitGlobalOptions(args: string[]): string[]` in `src/parser/stripGitGlobalOptions.ts`. Strip known globals before subcommand classification: `-C <path>`, `-c <name>=<value>`, `--git-dir=<path>`, `--work-tree=<path>`, `--namespace=<name>`, `--exec-path=<path>`, `-p`, `-P`, `--no-replace-objects`, `--no-lazy-fetch`, `--no-advice`, `--bare`, `--paginate`, `--no-pager`, `--help`, `--version`, `--html-path`, `--man-path`, `--info-path`. Handle both space-separated and `=`-joined forms.
- [ ] 9.2 Wire `stripGitGlobalOptions` into `ShellQuoteParser.classify()` so it runs when `program === "git"` BEFORE subcommand extraction.
- [ ] 9.3 Unit tests for `stripGitGlobalOptions`: each global option (space-separated + `=`-joined), multiple globals in sequence, no globals (passthrough), unknown flags (preserved).

## 10. Checkout/switch target disambiguation (LD7)

- [ ] 10.1 Implement `classifyCheckoutTarget(args: string[], cwd: string): CheckoutClassification` in `src/parser/checkoutTarget.ts`. Detect `--` separator → pathspec form → return `{ kind: 'file-restore' }`. Extract first positional after stripping flags. Handle `--detach`/`-d` → `{ kind: 'detached' }`. Handle `-` (previous) via `git rev-parse @{-1}`. Normalize `origin/feature` → strip remote prefix. Resolve via `git rev-parse --verify refs/heads/<X>` — if not a local branch ref → `{ kind: 'commit-ish' }`. Fail-open on git errors.
- [ ] 10.2 Unit tests for `classifyCheckoutTarget`: bare branch switch, file restore (`-- file.ts`), commit-ish, detached HEAD, remote-tracking (`origin/feature`), `-` (previous), empty args, flags-only.

## 11. Signal collection — repo, worktree, env families

- [ ] 11.1 Implement `RepoSignals` collector in `src/signals/RepoSignals.ts`. Collects `signals.repo.is_main_worktree` via `git rev-parse --git-dir` vs `--git-common-dir` (differ = linked worktree). Collects `signals.repo.name` via `git rev-parse --show-toplevel` → basename. Fail-open on errors.
- [ ] 11.2 Implement `WorktreeSignals` collector in `src/signals/WorktreeSignals.ts`. Extracts `signals.worktree.target_path` from positional args after `git worktree add|move|repair`. Uses `parseWorktreePath(args: string[]): string | null` that handles flag arity (-b/-B consume next arg, --detach/--orphan/--no-checkout don't, -- stops flag processing).
- [ ] 11.3 Implement `EnvSignals` collector in `src/signals/EnvSignals.ts`. Collects `signals.env.home` via `os.homedir()` (cross-platform, handles Windows USERPROFILE). Fail-open.
- [ ] 11.4 Wire all collectors into `collectAll()` array in `src/signals/index.ts`. Lazy collection: only invoke when `parsed.program === "git"`.
- [ ] 11.5 Unit tests for each collector: repo (main worktree, sub-worktree, non-repo), worktree (add path, move path, flags), env (home resolution).

## 12. Path canonicalization (LD6)

- [ ] 12.1 Implement `canonicalizePath(target: string, allowedPrefixes: string[]): CanonicalizeResult` in `src/util/canonicalizePath.ts`. Steps: (a) `fs.realpathSync(target)` — reject if fails. (b) Check resolved path has no `..` segments — reject if present. (c) Check basename is not `.git` — reject if so. (d) For each allowed prefix, `fs.realpathSync(prefix)` — skip if fails. (e) Check `startswith(resolved, allowed + path.sep)` for boundary enforcement.
- [ ] 12.2 Define `CanonicalizeResult = { resolved: string; allowed: boolean; reason?: string }`.
- [ ] 12.3 Unit tests: symlink escape → reject, `..` traversal → reject, `.git`-named target → reject, valid path under allowed prefix → allow, path not under any prefix → deny, missing target → reject (realpath fails).

## 13. Configuration — allowed branches + allowed dirs (LD3)

- [ ] 13.1 Extend `EngineConfig` in `src/config/Config.ts` with `allowedBranches?: string[]` and `worktreeAllowedDirs?: string[]`.
- [ ] 13.2 Add `parseAllowedBranches(envValue?: string): string[]` — default `["dev","staging","main","master"]`, empty string → `[]`. Reuse split-filter pattern (`.split(',').map(trim).filter(len>0)`).
- [ ] 13.3 Add `parseWorktreeAllowedDirs(envValue?: string): string[]` — default `[".worktrees","worktrees","~/.config/superpowers/worktrees"]`, empty string → `[]`. Expand `~` to `os.homedir()`.
- [ ] 13.4 Update `configFromEnv` to read `PIOPANET_ALLOWED_BRANCHES` + `PIOPANET_WORKTREE_ALLOWED_DIRS`.
- [ ] 13.5 Unit tests: trailing comma, whitespace, empty string, custom values, tilde expansion.

## 14. Rego rules — branch-target-allowlist + worktree-path-allowlist

- [ ] 14.1 Add `branch_target_allowlist` rule to `policy/safety.rego`: deny `checkout`/`switch` when `signals.repo.is_main_worktree` AND `target_branch` is a local branch ref AND `target_branch` ∉ `data.config.allowed_branches`.
- [ ] 14.2 Add `worktree_path_allowlist` rule: deny `worktree add|move|repair` when canonicalized path ∉ allowed prefixes (boundary-enforced `startswith`).
- [ ] 14.3 Update `OpaCliEngine` to pass `data.config.allowed_branches` and `data.config.worktree_allowed_dirs` in the OPA data bundle.
- [ ] 14.4 Wire canonicalized paths into OPA input (resolved target + resolved allowed prefixes as arrays).
- [ ] 14.5 Rego tests via `opa eval` for each new rule.
