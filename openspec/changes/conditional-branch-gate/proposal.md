## Why

pi-opa-net's policy input today is command tokens only — it cannot see the repo's current branch, working directory, or environment, so it cannot express conditional rules like "block `git checkout`/`switch` away from a protected branch (main/staging/dev/test/master)". This is the second time the schema wall has surfaced (cc-safety-net hit the same limit). The same architecture that makes this impossible for cc-safety-net (token-only Set equality) is fixable here by adding a context/signals input to OPA, borrowing Cupcake's "signals" design. Resolving it now lets every future context-dependent policy come for free and answers OT4's fork-retirement question cleanly.

## What Changes

- **Add a context/signals input** to the OPA evaluation: `input.signals.*`, sourced from a pluggable signal collector. v1 ships one signal: `git.current_branch` (and `git.target_branch` parsed from the command). `cwd` and `env` are threaded but read-only passthrough in v1.
- **Add a `branch-protection` Rego rule** that denies `git checkout`/`git switch` when `signals.git.current_branch` is in a configurable protected set AND the target is a different branch. Default protected set: `main`, `staging`, `dev`, `test`, `master`.
- **Extend the decision-output.v1 schema** with an optional `signals` object on the decision record (provenance: which signals fired and their values), non-breaking (additive field).
- **Add a signal-collection layer** (`src/signals/`) with one concrete collector (`GitSignals`) that shells `git rev-parse --abbrev-ref HEAD` against the command's cwd (copying the existing `execFileSync(git, ..., {cwd})` helper pattern). Fail-open on git errors (detached HEAD, non-repo, no git) → empty signal, rule skips.
- **Make the protected-branch set configurable** via env (`PIOPANET_PROTECTED_BRANCHES`) and rego `data.config`, defaulting to the 5-branch list. Empty set disables the rule.
- **No changes to fail-mode, exit codes, or the Claude Code hook protocol.** Branch-protection is a deny rule that emits the existing deny JSON shape.

**Non-goals (v1):**
- No multi-signal boolean policy language beyond what Rego already provides.
- No `env.*` value rules (env is collected but not gated on yet).
- No pi extension wiring (still OT5, separate `pi-opa-net-ext` repo).
- Does NOT touch the cc-safety-net fork (`pi-safety-net`, Path A) — that fork stays token-only.

## Capabilities

### New Capabilities
- `context-signals`: Pluggable signal-collection layer that enriches the OPA `input` with repo/environment context (`signals.git.current_branch`, `signals.git.target_branch`, `signals.env.cwd`) before evaluation. Fail-open on collection errors.
- `branch-protection`: Conditional policy rule that denies branch-switching away from protected branches, sourced from `signals.git.*` + a configurable protected set.

### Modified Capabilities
<!-- openspec/specs/ is empty (fresh project) — no existing capabilities to modify. -->
_(none — this is the first spec introduced for pi-opa-net)_

## Impact

- **Code:** new `src/signals/` module (`GitSignals.ts` + types); edits to `src/evaluator/` (collect signals → inject into OPA input), `policy/safety.rego` (new rule + `data.config.protected_branches`), `src/config/Config.ts` (parse `PIOPANET_PROTECTED_BRANCHES`).
- **Schema:** `schemas/decision-output.v1.json` gains optional `signals` field (additive, non-breaking). Bump schema description; keep `v1` marker (no v2).
- **API:** `CommandParserCoordinator` consumers unaffected; new public export `GitSignals`. CLI gains no new flags (signals auto-collected when cwd present).
- **Dependencies:** none new (uses Node `execFileSync`, already a dependency-free pattern).
- **Tests:** new e2e for branch-protection (protected branch → deny, non-protected → allow, detached HEAD → skip/allow, config override); signal-collection unit tests with git fixtures.
- **Docs:** README "Capabilities" + a `docs/signals.md` describing the signals input contract for future policy authors.
- **Tracked threads:** directly advances OT4 (signals design was the gap pi-opa-net had vs Cupcake); does not change LD1–LD5.
