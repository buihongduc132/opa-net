# Group G Main-Dir Gate Is Not Firing — Root-Cause Findings

- Origin: Slack opa-net thread, buihongduc132 2026-10-03 ("GATE the gitcheckout and ALL OF the other ways to checkout / change branch ... What is WRONG with the current configuration that keep allowing the agent to changing branches").
- Rule under test: `policy/safety.rego` GROUP G — `branch-target-allowlist` (deny `git checkout|switch <X>` when `X ∉ allowed` AND `signals.repo.is_main_worktree == true`). Default allowlist `{"dev","staging","main","master"}`; user spec adds `test`/`stag`.
- User main-dir spec (verbatim semantics): `dir == repo name` → main; else among worktrees/clone dirs of the same repo, **shortest dir name wins = MAIN**.

## F1 — Deployed engine is BROKEN: ajv `./core` missing → fail-open everywhere

- Repro: `pi-opa-net eval "git checkout wt/agy-mcp-bridge-doc" --json` (cwd `slack-configuration`, a MAIN worktree, target NOT in allowlist) →
  `error: Cannot find module './core' from '.../pi-opa-net/node_modules/ajv/dist/ajv.js'` (Bun 1.3.11).
- Same error from BOTH installs:
  - `~/.pi/agent/packages/opa-net` (pi stage-1 prod, loaded via `settings.json` `packages/opa-net`)
  - `~/.local/share/mise/installs/node/22.22.2/lib/node_modules/pi-opa-net` (global CLI)
- Both `node_modules/ajv/dist/` have NO `core.js` — broken/incomplete install (known 0.7.0 deploy problem class; see `flow/plans` lessons in repo 84b2ff5).
- Consequence: every eval throws BEFORE policy evaluation; `src/pi/tool-call.ts` catch → `return undefined` (fail-open default, non-strict) → **agent sees zero gates at all**. This alone explains "keep allowing the agent to changing branches".

## F2 — MAIN-dir detection ≠ user spec (git-native ≠ shortest-name)

- `src/signals/RepoSignals.ts` marks main = `git rev-parse --git-dir == --git-common-dir` (parent worktree of ONE repo).
- User spec: dir basename == repo name → main; ELSE among a repo's sibling dirs the SHORTEST basename is main.
- Fleet reality: siblings like `beet-orches` (main, `.git`==`.git` verified) + `beet-orches-bgn-wt` (linked, `.git` FILE → parent) are handled correctly by git-native. BUT standalone clones (e.g. `slack-configuration` + `slack-configuration-wt`, `n8n-configuration` + `n8n-configuration-wt` — each a separate repo root, not linked worktrees) ALL present `--git-dir == --git-common-dir` → ALL classified main → GROUP G fires on ALL of them; conversely a sibling-clone layout where the LONGER name is the true main inverts the rule.
- Net: for `-wt` sibling clones the current signal is not the user's semantics; only the git-native linked-worktree case matches.

## F3 — Branch classification holes let `checkout` through even with ajv fixed

- `src/parser/checkoutTarget.ts`:
  - `git checkout -b <name>` → FLAGS_NO_VALUE doesn't include `-b`; first positional `<name>` gets `rev-parse refs/heads/<name>` → new branch doesn't exist yet → classified `commit-ish`, not `branch` → GROUP G never matches. **`checkout -b` creates AND switches in one step — completely ungated.**
  - `git checkout -c` same hole.
  - `git checkout origin/feature` → strips remote prefix → `feature`; if local branch exists → gated; if only remote → `commit-ish` → **DETACHED-CHECKOUT ESCAPE** (checkout of remote ref = branch change without branch).
  - `git checkout <sha>` / `--detach` → `commit-ish`/`detached` → not gated (detached HEAD = branch change; arguably needs allow or explicit deny).
  - FLAGS_WITH_VALUE handles `--source` but `git checkout --source <x> <branch>` order-variants not fully covered.
- `src/cli/run.ts:314` enriches signals only when `parsed.subcommand === 'checkout' || 'switch'` — but `git -C /other/dir checkout X` relies on `parsed.gitCwd` (LD8, run.ts:153) — OK; wrapped compound (`cd foo && git checkout X`) — `splitTopLevelSegments` handles `&&`, but `cd` prefix segment then changes real cwd at exec time; classifier uses eval-time cwd → **classification against the wrong repo** possible.

## F4 — Escape hatches (other ways to change branch) not covered by ANY rule

- `git switch` gated (GROUP G) — OK once signals fire.
- NOT gated: `git switch -c/-C` (switch -C gated only via block-git-switch-C; `switch -c` creates+switches → classify gives `branch`? new branch nonexistent → `commit-ish`/none → passes), `git checkout <sha>`, `git worktree add ... <branch>` (GROUP H checks PATH not branch), `git symbolic-ref HEAD refs/heads/X`, `git update-ref refs/heads/...`, `git clone --branch` (benign), `git rebase --onto` etc.
- USER INTENT: "GATE ... and ALL OF the other ways to checkout / change branch". Current rule family covers only 2 of the N mutation paths.

## F5 — Allowed-branch list mismatch

- User allowlist: `dev / main / staging / test / stag / master`. Default in rego+config: `{dev, staging, main, master}` — **missing `test`, `stag`**; no `PIOPANET_ALLOWED_BRANCHES` env set anywhere on host (checked `~/.pi/agent/settings.json`, shell env empty) → agents ON allowed branches `test`/`stag` would be BLOCKED once the gate actually fires — inverse annoyance.

## F6 — Hermes side: gate not wired AT ALL

- Every Hermes profile config (`/mnt/sata-docker/hermes-profiles/*/config.yaml`, incl. hermes-plan:724, main:601, coder, beet-coder) has `hooks: pre_tool_call: []`.
- `~/.hermes/shell-hooks/cc-safety-net.sh` exists but (a) is not referenced by any config, and (b) calls `cc-safety-net` which is a BROKEN symlink: `~/.local/bin/cc-safety-net → ~/.local/share/mise/shims/cc-safety-net` (target missing; mise has no cc-safety-net install).
- Repo has `packages/hermes-opa-net` (Hermes pre_tool_call hook plugin, `src/hermes/tool-call.ts`) — NOT installed/wired into any profile.
- Net: Hermes agents run with ZERO command gate; pi agents run with a gate that fail-opens (F1).

## Evidence index

- rego GROUP G: `policy/safety.rego:765-823` (local repo @ main, 84b2ff5)
- signals: `src/signals/RepoSignals.ts` (whole file, git-dir vs common-dir)
- classifier: `src/parser/checkoutTarget.ts:95-190` (`classifyPositional`, FLAGS sets at 30-70)
- enrichment gate: `src/cli/run.ts:313-322`
- fail-open plugin path: `src/pi/tool-call.ts:132-137`
- ajv breakage repro: command + error above (F1); both install roots listed
- siblings verified: `beet-orches` (gitdir .git), `beet-orches-bgn-wt` (gitdir → parent .git/worktrees/...), `slack-configuration` branch `wt/agy-mcp-bridge-doc` w/ local ref `32e8f0d` (reflog shows creation from HEAD)
