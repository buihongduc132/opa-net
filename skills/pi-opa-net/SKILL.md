---
name: pi-opa-net
description: OPA-backed bash command guard for the pi ecosystem. Use when you need to evaluate shell commands against a safety policy and get structured JSON output (decision-output.v1 schema), wire a bash guard into a pi extension, or understand fail-open/fail-closed behavior. NOT for the rego policy authoring itself (edit policy/safety.rego directly).
---

# pi-opa-net — OPA-backed bash guard

An **agent-agnostic** engine + CLI that evaluates shell commands against an [OPA](https://www.openpolicyagent.org/)/Rego policy and emits a strict, auditable `decision-output.v1` record. Designed as the decision backend for pi extensions, Claude Code hooks, and scripts.

## When to use

- Wiring a bash command guard into a pi extension (the extension shells out to this CLI and parses the JSON).
- Evaluating a command programmatically and needing rule provenance (`reasons[].rule_id`).
- Replacing asymmetric allow-silent/deny-string output with a symmetric schema.
- Detecting rulebook drift via `metadata.rulebook_digest`.

## When NOT to use

- You need the **pi extension tool_call hook itself** — that lives in a separate `pi-opa-net-ext` repo (OT5). This package is the engine + library, not the hook.
- You want OPA policy for non-bash domains (deploy-gating, k8s, API authz) — out of scope (LD3).

## Quick start

```bash
# CLI
bunx pi-opa-net eval "git stash pop" --json   # exit 2 + JSON
bunx pi-opa-net eval "git stash list"          # exit 0, empty stdout

# Programmatic
import { configFromEnv, CommandParserCoordinator, OpaCliEngine, DecisionBuilder, RULES, RuleRegistry } from 'pi-opa-net';
```

## Output shape

Every decision (allow AND deny) emits `decision-output.v1`:

- `decision`: `allow | deny`
- `source`: `opa | fail-open | fail-closed | cached`
- `reasons[]`: `{ rule_id, message, family, severity }` — empty on allow
- `input`: `{ raw, program, subcommand, args, parse_confidence }`
- `metadata`: `{ engine, opa_version, rulebook_digest, policy_path, hostname, session_id }`
- `decision_id` (uuid), `evaluated_at` (ISO-8601), `duration_ms`

Exit codes: `0 = allow`, `2 = deny` (Claude Code hook protocol compatible).

## Fail-mode

- `PI_OPA_FAIL_MODE=open` (default) — allow when OPA unreachable, `source: "fail-open"`.
- `PI_OPA_FAIL_MODE=closed` — deny when OPA unreachable, `source: "fail-closed"`.

The `source` field makes whichever mode fires **observable** per-decision.

## Adding a rule

1. Add a `deny[msg] if { ... }` block to `policy/safety.rego`.
2. Mirror it in `src/rules/catalog.ts` (same message string).
3. The catalog↔rego parity test enforces zero drift.

## References

- Schema: [`schemas/decision-output.v1.json`](https://github.com/buihongduc132/pi-opa-net/blob/main/schemas/decision-output.v1.json)
- Policy: [`policy/safety.rego`](https://github.com/buihongduc132/pi-opa-net/blob/main/policy/safety.rego)
- Decisions: [`docs/locked-decisions.yaml`](https://github.com/buihongduc132/pi-opa-net/blob/main/docs/locked-decisions.yaml), [`docs/open-threads.yaml`](https://github.com/buihongduc132/pi-opa-net/blob/main/docs/open-threads.yaml)
