## Context

`pi-opa-net` already contains an explore-grade OPA/Rego translation of the `cc-safety-net` user rulebook at `policy/safety.rego`, mirrored by a TypeScript provenance catalog at `src/rules/catalog.ts`. Today that translation covers 37 of the 42 rules in the active `~/.cc-safety-net/rules/user-rules/rulebook.json`, and several `reason` strings are paraphrased rather than copied verbatim. The four missing rules are the tmux/wezterm session-kill family (`block-tmux-kill-server`, `block-tmux-kill-session`, `block-pkill-tmux-wezterm`, `block-killall-tmux-wezterm`).

Constraints inherited from the project:

- Decision output is locked to `decision-output.v1` (see `schemas/`, `docs/locked-decisions.yaml`).
- `policy/safety.rego` is fail-open (`default allow := true`) and consumes a normalized `{program, subcommand, args, raw}` input struct produced by `src/parser/`.
- `src/rules/catalog.ts` is the single source of truth for `rule_id` + `family` + `message`; the parity test (`tests/unit/rules/catalog-parity.test.ts`) fails when the rego deny messages drift from the catalog.

## Goals / Non-Goals

**Goals:**

- Achieve 1:1 parity between the active `cc-safety-net` user rulebook (42 rules) and `pi-opa-net`'s OPA policy + catalog.
- Add the four missing tmux/wezterm deny rules to both `safety.rego` and `catalog.ts`.
- Align every deny message and rule ID to the canonical rulebook so audits trace `decision.reasons[].rule_id` → rulebook rule name → `reason` text.
- Expand the parity/test matrix so every rulebook `tests[]` fixture plus the new tmux fixtures is exercised.

**Non-Goals:**

- No change to the parser, engine, CLI flags, or `decision-output.v1` schema.
- No new external dependencies or signals layer (that is the separate `conditional-branch-gate` change).
- No pi-extension wiring (still OT5).
- Does not retire `cc-safety-net` itself; this only achieves rule parity so retirement is possible later.

## Decisions

### D1 — Verbatim `reason` text, not paraphrase

Each OPA deny message and each catalog `message` SHALL copy the `reason` field from the rulebook verbatim.

- **Why:** guarantees audits match the human-authored rulebook exactly and removes ambiguity when reconciling drift.
- **Alternative considered:** keep the shorter paraphrased messages — rejected because it defeats provenance tracing.

### D2 — Rule IDs equal canonical rulebook rule names

Catalog `ruleId` values SHALL use the exact `name` from the rulebook (e.g., `block-stop-docker-entirely`), not the current shortened aliases (e.g., `block-docker-stop`). This renames existing IDs.

- **Why:** the catalog is the provenance layer; matching the source-of-truth names removes a translation step.
- **Trade-off:** existing `reasons[].rule_id` consumers see renamed IDs. This is acceptable because the project is pre-1.0 and no external consumer depends on the alias names yet (documented as a callout in tasks).

### D3 — tmux/wezterm family as a new rego group

Add a new **GROUP G — tmux / pkill / killall session protection** to `safety.rego`. `tmux` uses `subcommand` matching (`kill-server`, `kill-session`); `pkill`/`killall` use command-level token matching against `["tmux", "wezterm", "wezterm-mux-server"]`, mirroring the rulebook `block_args`.

- **Why:** reuses the existing `has_any_arg` helper and the `docker_blocked_subcommands` map pattern; no new helper required.
- **Alternative considered:** a generic "session process kill" rule — rejected because the rulebook scopes it to specific binaries, and faithfulness is the goal.

### D4 — Catalog parity test asserts against the rulebook

The parity test SHALL load the canonical rulebook JSON, derive the expected rule set, and assert that every rulebook `name` appears in `catalog.ts` and that each catalog message equals the rulebook `reason`. The 4 tmux/pkill/killall rules and their `tests[]` fixtures are added as e2e deny cases.

- **Why:** makes future rulebook drift a CI failure, not a manual audit.

### D5 — `gcloud` / `bq` keep `sprintf` messages, with per-verb provenance

`gcloud`/`bq` rules produce dynamic messages (`sprintf("... '%s' ...", [verb])`). Keep this, but add catalog entries for each verb so `RuleRegistry.lookup` resolves the dynamic message to the canonical rule name `block-gcloud-destructive-verbs` / `block-bq-destructive-verbs`.

- **Why:** avoids 15+ near-duplicate rego rules while preserving a stable rule ID.

## Risks / Trade-offs

- **[Risk] Renaming existing rule IDs breaks any consumer matching on the alias names** → Mitigation: project is pre-1.0; update README rule count; note in `CHANGELOG.md`. No external contract pins the alias names.
- **[Risk] Verbatim `reason` strings change existing deny messages** → Mitigation: parity test covers both directions; this is intentional drift correction.
- **[Risk] Rulebook is a living file outside this repo** → Mitigation: pin the parity test to a committed snapshot of the rulebook under `tests/fixtures/` and document the sync procedure in tasks, so CI is reproducible.
- **[Trade-off] `tmux kill-session` blocks both `-t foo` and `-a` forms** — matches rulebook behavior; some legitimate single-session kills will be blocked intentionally.

## Migration Plan

1. Commit a snapshot of the active rulebook to `tests/fixtures/user-rules.rulebook.json` as the parity baseline.
2. Port the 4 missing rules and reconcile messages/IDs in `safety.rego` + `catalog.ts`.
3. Update `catalog-parity.test.ts` to assert against the fixture.
4. Run `bun run check` (typecheck + lint + tests) until green.
5. Rollback = revert the change; no schema/engine migration required.

## Cupcake format compatibility (objective addendum)

The objective requires the port to be **Cupcake-compatible Rego** so it can later be consumed by [eqtylab/cupcake](https://github.com/eqtylab/cupcake). Cupcake's policy contract (per deepwiki `6.1-custom-policy-structure` + `3.2-rego-and-open-policy-agent`):

- Three-part file anatomy: `# METADATA` block (with `scope: package`, `required_events`, `required_tools`, optional `signals`) FIRST → `package cupcake.policies.<name>` → `import rego.v1` → decision-verb rules.
- Decision verbs: `deny contains { "rule_id": ..., "reason": ..., "severity": ... } if { ... }`. System aggregation entrypoint `cupcake.system.evaluate` walks `data.cupcake.policies.*` and collects verbs.
- **Mandatory self-filtering**: every policy MUST check `input.hook_event_name == "PreToolUse"` and `input.tool_name == "Bash"` inside its rule bodies (metadata is routing optimization only).
- Input shape: `input.hook_event_name`, `input.tool_name`, `input.tool_input.command` (Bash), `input.cwd`, `input.signals.*`.
- Rego v1 syntax: `import rego.v1`, `deny contains ... if`, object membership via `object.keys()`.

**Implementation consequence:** the PRIMARY deliverable is a new `.cupcake/policies/claude/cc_safety_net_parity.rego` (+ `.cupcake/system/evaluate.rego`) that ports all 42 rules in cupcake format with verbatim `reason` text and rulebook `name` as `rule_id`. The existing pi-opa-net engine (`policy/safety.rego` + `src/rules/catalog.ts`) stays as the agent-agnostic engine; we additionally add the 4 missing tmux rules there for full 42-rule parity.

## Open Questions

- None blocking. Whether to fully retire `cc-safety-net` afterward is tracked separately (OT4/OT5).
