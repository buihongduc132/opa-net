## Why

`cc-safety-net` currently enforces 42 user-scope rules across this machine. `pi-opa-net` already hosts an OPA/Rego translation, but it only covers 37 of those rules and paraphrases several `reason` strings. To fully retire the `cc-safety-net` rulebook dependency and make `pi-opa-net` the single source of truth for bash command guarding, the remaining rules must be ported faithfully and the existing policy must be reconciled with the canonical rulebook.

## What Changes

- **Add the 4 missing `cc-safety-net` rules** to `policy/safety.rego` and `src/rules/catalog.ts`:
  - `block-tmux-kill-server`
  - `block-tmux-kill-session`
  - `block-pkill-tmux-wezterm`
  - `block-killall-tmux-wezterm`
- **Reconcile all 42 rule messages** in `safety.rego` and `catalog.ts` with the canonical `reason` text from the active `~/.cc-safety-net/rules/user-rules/rulebook.json` so rule IDs and messages trace back 1:1 to the source rulebook.
- **Normalize rule IDs** in the catalog to match the `cc-safety-net` rule names (e.g., `block-docker-stop` → `block-stop-docker-entirely`) for unambiguous audits.
- **Expand the parity test matrix** in `tests/unit/rules/catalog-parity.test.ts` to cover all 42 rulebook tests plus the 4 new tmux/wezterm fixtures.
- **No breaking changes** to the CLI, schema, or engine contract; only the deny-message/rule-id provenance layer changes.

## Capabilities

### New Capabilities

- `cc-safety-net-rule-parity`: Faithful OPA translation of all 42 active `cc-safety-net` user rules, with matching `reason` text, rule IDs, and test fixtures, including the new tmux/wezterm session-protection family.

### Modified Capabilities

_(No spec-level requirement changes outside the rule parity scope above.)_

## Impact

- **Code:** `policy/safety.rego` gains new deny rules and message updates; `src/rules/catalog.ts` gains new entries and renamed rule IDs; `tests/unit/rules/catalog-parity.test.ts` gains additional fixtures.
- **API/CLI:** Decision output remains `decision-output.v1` schema; `reasons[].rule_id` values will now match the canonical `cc-safety-net` rule names.
- **Dependencies:** None new.
- **Tests:** Catalog parity test must pass against the full 42-rule rulebook plus existing engine/parser tests.
- **Docs:** README rule count updates from 37 to 42; `CHANGELOG.md` entry added.
