# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Context signals + conditional branch-protection gate** (`conditional-branch-gate`).
  - `src/signals/GitSignals.ts` collects `signals.git.{available, current_branch, target_branch}`
    by shelling `git rev-parse --abbrev-ref HEAD` in the decision cwd.
  - `src/signals/parseGitTargetBranch.ts` extracts the target branch from
    `git checkout/switch <branch>` while ignoring flags.
  - `src/signals/collectAll.ts` merges collectors; thrown errors are suppressed
    to `{ available: false }` (fail-open).
  - `policy/safety.rego` adds a branch-protection deny rule: `git checkout/switch`
    off a protected branch to a different branch is denied. Protected branches
    come from `data.config.protected_branches` loaded via a temp data document.
  - `src/config/Config.ts` adds `parseProtectedBranches` and
    `PIOPANET_PROTECTED_BRANCHES` env support (default: `main,staging,dev,test,master`).
  - `src/engine/OpaCliEngine.ts` accepts optional `{ signals, protectedBranches }`
    and extends the OPA `input` with `signals`; writes the protected-branches
    data document when the list is non-empty.
  - `src/output/DecisionBuilder.ts` includes `signals` in the decision-output record.
  - `schemas/decision-output.v1.json` adds an optional, additive `signals` property.
  - `docs/signals.md` documents the signal contract and how to add a new collector.
  - Public API surface in `src/index.ts` exports `GitSignals`, `collectAll`,
    `parseGitTargetBranch`, and signal types.

### Changed

- README updated to document `PIOPANET_PROTECTED_BRANCHES` and the new branch-protection capability.
- `docs/open-threads.yaml` OT5 updated to note that the signals gap is resolved inside the engine.

## [0.1.0] - 2026-07-01

### Added

- **decision-output.v1 schema** — JSON Schema draft 2020-12, strict (`additionalProperties: false`). Symmetric allow + deny output with rule provenance, fail-mode observability, and parse-confidence surfacing. 4 canonical examples, all validated by a hard test gate.
- **OPA decision engine** (`OpaCliEngine`) — subprocess `opa eval` with temp-file input, fail-open/fail-closed branching, SHA-256 rulebook digest for drift detection.
- **Hybrid command parser** — `ShellQuoteParser` (AST primary) + `RegexFallbackParser` (fallback), coordinated via `CommandParserCoordinator`. Program-aware subcommand classification (git/docker/gh/glab subcommand-style; rm/bd/gcloud/bq args-only).
- **Rule registry + 37-rule catalog** mirroring `policy/safety.rego` message-for-message. A bidirectional parity test enforces zero drift between rego and the TS catalog.
- **CLI** (`pi-opa-net eval`) — claude-code mode (suppress allow stdout) and `--json` mode (always emit schema). Exit codes `0 = allow`, `2 = deny` (Claude Code hook protocol compatible). Reads from args or stdin.
- **Rego policy** (`policy/safety.rego`) — covers git, docker, docker-compose carve-outs, rm, gh, glab, gcloud, bq, bd families. Native bare-default handling (`git stash` ≡ push).
- **Env-driven config** — `PI_OPA_FAIL_MODE`, `PI_OPA_TIMEOUT_MS`, `PI_OPA_BINARY` (mise-aware discovery), `PI_OPA_HOSTNAME`, `PI_OPA_SESSION_ID`.
- **Decision-design docs** — `docs/locked-decisions.yaml` (LD1–LD5), `docs/open-threads.yaml` (OT1–OT5, all resolved with rationale).
- **CI** — GitHub Actions workflow (typecheck + lint + test + coverage on ubuntu/macos).
- **Skill doc** — `skills/pi-opa-net/SKILL.md` for pi agent discovery.

### Resolved design threads

- **OT1 (parser)** — hybrid: AST primary, regex fallback; `parse_confidence` surfaces path per-decision.
- **OT2 (fail-mode)** — fail-open default (matches pi-safety-net fork), configurable to fail-closed.
- **OT3 (bare git stash)** — handled natively in rego (`subcommand == "stash" && count(args) == 0`).
- **OT4 (fork disposition)** — pi-safety-net kept as Path A (non-pi agents); pi-opa-net is Path B (OPA-backed).
- **OT5 (pi extension wiring)** — deferred to a separate `pi-opa-net-ext` repo; this package exposes the engine + library + CLI.

### Tests

- 106 tests across 10 files (unit + e2e + schema gate).
- Line coverage 98.89%, function coverage 88.98%.
- E2E runs the live CLI against real OPA 1.18.1 — 20 distinct deny rules fire (≥40% of the 37-rule catalog) plus 5 allow carve-outs and fail-open/fail-closed paths.
