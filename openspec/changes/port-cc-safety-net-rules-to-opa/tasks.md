## 1. Baseline fixture

- [ ] 1.1 Copy the active `~/.cc-safety-net/rules/user-rules/rulebook.json` to `tests/fixtures/user-rules.rulebook.json` (42-rule baseline, includes tmux/pkill/killall family)
- [ ] 1.2 Add a short comment at the top of the fixture noting the rulebook version (`1.0.0`) and the sync source path

## 2. Cupcake-format Rego policy (PRIMARY DELIVERABLE)

- [ ] 2.1 Create `.cupcake/system/evaluate.rego` — minimal aggregation entrypoint `cupcake.system.evaluate` that collects `deny` verbs across `data.cupcake.policies.*` (compatible with the cupcake `PreToolUse` Bash flow)
- [ ] 2.2 Create `.cupcake/policies/claude/cc_safety_net_parity.rego` with the mandatory 3-part cupcake anatomy: `# METADATA` block (`scope: package`, `required_events: ["PreToolUse"]`, `required_tools: ["Bash"]`), `package cupcake.policies.cc_safety_net_parity`, `import rego.v1`
- [ ] 2.3 Implement self-filtering guards (`input.hook_event_name == "PreToolUse"`, `input.tool_name == "Bash"`) plus tokenization helpers that split `input.tool_input.command` into `program`, `subcommand`, `args[]` (lowercase program, regex whitespace split, empty subcommand when single token)
- [ ] 2.4 Port all 42 rules from the rulebook fixture as `deny contains { "rule_id": <rulebook name>, "reason": <rulebook reason verbatim>, "severity": "high" } if { ... }` — every rulebook `name` MUST appear as a `rule_id`
- [ ] 2.5 Use the rulebook `reason` text verbatim in every `reason` field; for `gcloud`/`bq` use `sprintf` only where the rulebook reason itself is templated (it is not — keep verbatim)
- [ ] 2.6 Run `opa fmt -w` and `opa check` on the new policy files; both MUST pass clean

## 3. pi-opa-net engine parity (4 missing tmux rules)

- [ ] 3.1 Add the 4 tmux/wezterm deny rules to `policy/safety.rego` (GROUP G): `tmux kill-server`, `tmux kill-session`, `pkill`/`killall` against `tmux|wezterm|wezterm-mux-server`
- [ ] 3.2 Add matching entries to `src/rules/catalog.ts` with `ruleId` = rulebook `name`, family `tmux`/`pkill`/`killall` (extend `RuleFamily` if needed), message = rulebook `reason` verbatim
- [ ] 3.3 Add e2e deny/allow cases to `tests/` for the 4 new rules + carve-outs (`tmux ls`, `pkill firefox`, `killall vim`)

## 4. Tests for the cupcake policy (RED-first)

- [ ] 4.1 Add `tests/cupcake/cc_safety_net_parity.test.ts` — bun test that loads `tests/fixtures/user-rules.rulebook.json`, runs `opa eval` over every rulebook `tests[]` fixture against the cupcake policy (entrypoint `data.cupcake.system.evaluate`), and asserts `decision == expect` and (for blocked) `rule_id == fixture.rule`
- [ ] 4.2 Add explicit scenarios for the 4 tmux/pkill/killall rules and the allowed carve-outs (`tmux ls`, `tmux attach -t work`, `pkill firefox`, `killall vim`)
- [ ] 4.3 Add a parity assertion: every rulebook `name` appears as a `rule_id` in at least one deny produced across the blocked fixtures
- [ ] 4.4 Add a non-Bash / non-PreToolUse input scenario asserting the policy self-filters to allow (no deny) — proves cupcake self-filtering requirement

## 5. Docs + verification

- [ ] 5.1 Add `docs/cupcake-parity.md` describing the cupcake-format policy, how to eval it standalone, and how it maps 1:1 to the rulebook
- [ ] 5.2 Update README "Status" rule count (37 → 42) and add a "Cupcake-compatible policy" section pointing at `.cupcake/`
- [ ] 5.3 Add a `CHANGELOG.md` entry for the cupcake-format policy + the 4 new tmux rules
- [ ] 5.4 Run `bun run check` (typecheck + lint:ci + tests with coverage) until green
- [ ] 5.5 Manual smoke: `opa eval -d .cupcake -i <input.json> 'data.cupcake.system.evaluate'` for `tmux kill-server` (deny) and `git status` (allow)
