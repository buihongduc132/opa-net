# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-07-23

### Fixed

- CRITICAL: declared `pi.extensions` in package.json so pi-coding-agent's extension loader can discover the `tool_call` hook. Without this, the entire safety guard was a silent no-op (extension loaded but hook never registered).

## [0.2.0] - 2026-07-20

### Added

- **Capability-based unlock-keys** (`src/unlock/`) — trusted agents present a per-rule salted HMAC key (long-lived `ll_<16hex>` or TTL `ttl.<exp>.<16hex>`); the TS-side post-eval filter demotes matching deny reasons. Schema stays v1 (additive). Policy file `safety.rego` is unchanged.
- **`unlock-key` CLI subcommand** — `pi-opa-net unlock-key <rule_id> [--ttl <sec>]` mints keys; `--list` enumerates catalog rule_ids. Refuses unknown rule_ids and the god-key `PIOPANET_UNLOCK_ALL`.
- **Three delivery channels** — `PIOPANET_UNLOCK_KEYS` env (comma-separated), `--unlock <key>` (repeatable), `--unlock-stdin` (requires positional command arg).
- **Salt seam** (`SaltResolver`) — deploy-local `~/.pi-opa-net/salt` with auto-gen (atomic `wx`, mode 0o600), env override (`PIOPANET_UNLOCK_SALT` literal, `PIOPANET_UNLOCK_SALT_FILE` path), warn on world-readable. Interface for future remote/keychain resolver.
- **Audit seam** (`AuditSink` + `NoOpSink`) — decision record is the sole audit surface in v1. Interface for future `FileAppendSink`/`WebhookSink`.
- **All-or-nothing multi-rule semantics** — allow ⟺ every `severity:block` reason has a matching valid key. Partial bypass forbidden; `metadata.unlock_blocked_count` records remaining blockers.
- **Three new schema sources** — `'opa-unlocked'` (legitimate bypass), `'fail-open-keyless'` (OPA down + keys present, auditable degradation), `'unlock-filter-error'` (filter crash falls back to un-filtered decision, never allows-by-accident).
- **Cache poisoning guard** — when unlock keys present, `cacheTtlMs` forced to 0 regardless of `PI_OPA_CACHE_TTL_MS`.
- **Decision-output.v1 schema (additive)** — `reasons[]` gains optional `bypassed`, `unlock_key_id` (first 8 hex only — full key NEVER logged), `unlock_key_type`, `unlock_expires_at`, `unlock_status`; `metadata` gains `unlock_count`, `unlock_blocked_count`, `unlock_agent`. `additionalProperties:false` preserved everywhere.
- **OpenSpec change** at `openspec/changes/rule-unlock-keys/` — proposal, design (D1–D11), spec (REQ-001..018 + 9 scenarios), tasks.
- **109 new tests** (304 total pass) covering key derivation, parser, verifier, filter, salt resolver, audit sink, decision builder integration, CLI, schema, and e2e flow. Typecheck + lint clean.

### Decisions (locked, immutable)

- **LD-L1**: per-rule granularity (one rule = one key, no per-command)
- **LD-L2**: no god-key (refuse `PIOPANET_UNLOCK_ALL`)
- **LD-L3**: two lifetimes (LL + TTL) via self-describing prefix
- **LD-L4**: delivery = ENV + `--unlock` + `--unlock-stdin`
- **LD-L6**: TS-side post-eval filter (keys never enter OPA input/trace)
- **LD-Y1/Y2**: deploy-local salt + NoOp audit (YAGNI seams for future)
- **LD-G1**: fail-open+keys → `source:fail-open-keyless`
- **LD-G2**: `--unlock-stdin` requires positional command
- **LD-G3**: `cacheTtlMs` forced 0 when keys present
- **LD-G6**: all-or-nothing multi-rule semantics
- **LD-G8**: filter crash → fall back to un-filtered decision

### Verifier-loop

- Pre-merge: jewilo 2/2 APPROVE, hash `072026-c604475a` (fullDigest `c604475a...`).
- Post-merge: jewilo-dev with rag-quick model 2/2 APPROVE, hash `072026-7291243b`.

## [Unreleased]

### Added

- **Cupcake-compatible policy** (`.cupcake/policies/claude/cc_safety_net_parity.rego`) that ports all 42 active `cc-safety-net` user rules into OPA/Rego v1 with the Cupcake custom-policy structure: `# METADATA`, `package cupcake.policies.cc_safety_net_parity`, `import rego.v1`, and mandatory self-filtering. The aggregation entrypoint `data.cupcake.system.evaluate` is provided in `.cupcake/system/evaluate.rego`.
- **Rulebook fixture** at `tests/fixtures/user-rules.rulebook.json` and a new `tests/cupcake/cc_safety_net_parity.test.ts` suite that runs all 53 rulebook `tests[]` fixtures + 12 tmux/pkill/killall scenarios + self-filtering checks.
- **4 missing tmux/pkill/killall rules** to the pi-opa-net engine (`policy/safety.rego`, `src/rules/catalog.ts`) for full 42-rule parity with the active `cc-safety-net` rulebook.
- **DecisionBuilder disambiguation** for rules that share identical reason text (the tmux session-kill family): the registry now maps `(message, family)` to rule metadata when a raw deny carries a `family` hint, falling back to the previous message-only lookup.
- **Documentation**: `docs/cupcake-parity.md` describing the Cupcake policy and standalone `opa eval` usage; README updated to reflect the 42-rule catalog and the new policy file.
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
