# References

> Sources consulted during this explore session.

## Source files

- `README.md` — project overview, status (v0.1.0), architecture (two-halves), schema v1 contract, fail-mode, env config
- `src/rules/catalog.ts` — canonical rule catalog (41 entries), rule_id + family + suggestions, inferFamilyFromProgram helper
- `policy/safety.rego` — OPA/Rego v1 policy, 37 deny blocks, `package safety`, `default allow := true` (fail-open), helpers `has_any_arg` + `has_arg_prefix`
- `src/util/digest.ts` — `sha256Prefix(path)` → first 12 hex chars of SHA-256, used for rulebook drift detection
- `src/output/DecisionBuilder.ts` — schema assembly class, `DecisionOutput` interface, `Reason` interface with `severity: 'block'`, `build()` method wires parsed + engine → output
- `src/cli/run.ts` — `runCli()` orchestrator: resolveRaw → configFromEnv → parse → engine.evaluate → builder.build → validateDecision → formatter.format
- `docs/cupcake-parity.md` — Cupcake-compatible policy documentation, 42 active cc-safety-net user rules ported, standalone `opa eval` examples
- `openspec/changes/conditional-branch-gate/proposal.md` — in-flight change adding `input.signals.*` for branch-protection rule, solved the "signals gap" vs Cupcake
- `openspec/changes/conditional-branch-gate/design.md` — D1–D5 decisions for signals layer, GitSignals collector, protected-branch config, schema additive `signals` field

## Documents

- `~/.cc-safety-net/rules/user-rules/rulebook.json` — canonical cc-safety-net user rulebook (42 active rules), source of truth for parity port
- `tests/fixtures/user-rules.rulebook.json` — deterministic snapshot of the canonical rulebook for CI
- `schemas/decision-output.v1.json` — JSON Schema draft 2020-12, strict (`additionalProperties: false`), the symmetric decision record contract
- `~/.pi/agent/cmd-family/ospx.yml` — ospx family manifest (step 10/70), governs explore-mode stance

## Code patterns

- `sha256Prefix` in `src/util/digest.ts` — existing hash utility; candidate foundation for unlock key derivation (HMAC variant)
- `DecisionBuilder.build()` pipeline in `src/output/DecisionBuilder.ts` — the assembly point where unlock filter would inject (between engine.evaluate and builder.build, or inside builder)
- `runCli()` orchestration in `src/cli/run.ts` — the wiring point where unlock keys would be threaded (parse env/args → inject into evaluation pipeline)
- `deny[msg]` rego pattern in `policy/safety.rego` — existing deny-rule shape; unlock check lives TS-side so this file needs NO CHANGE
- `RULES` catalog in `src/rules/catalog.ts` — rule_id is the hash input for unlock key derivation; catalog already correct, needs no change
- Cupcake `input.signals.*` pattern from `openspec/changes/conditional-branch-gate/proposal.md` — sibling pattern for adding context to OPA input; unlock-keys uses a different approach (TS-side filter) but the signals design validates the additive-schema philosophy
