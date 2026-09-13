# Cupcake-compatible cc-safety-net policy

This directory contains a [Cupcake](https://github.com/eqtylab/cupcake)-compatible Open Policy Agent (OPA) Rego policy that ports the 42 active `cc-safety-net` user rules.

## Layout

```text
.cupcake/
├── system/evaluate.rego
└── policies/claude/
    └── cc_safety_net_parity.rego
```

- `cc_safety_net_parity.rego` — the policy. It self-filters on `input.hook_event_name == "PreToolUse"` and `input.tool_name == "Bash"`, tokenizes `input.tool_input.command`, and emits `deny` verbs with `rule_id` + `reason` + `severity`.
- `evaluate.rego` — aggregation entrypoint `data.cupcake.system.evaluate` that returns `{ decision, deny, reasons }`.

## Rule source

The canonical source of truth is the active `cc-safety-net` user rulebook:
`~/.cc-safety-net/rules/user-rules/rulebook.json`.

A snapshot is committed at `tests/fixtures/user-rules.rulebook.json` so the parity test suite is deterministic and reproducible in CI.

- Every rulebook `name` appears as a `deny.rule_id` in the policy.
- Every `reason` is copied verbatim from the rulebook.
- The 4 new rules not previously in `pi-opa-net` are the tmux / pkill / killall session-kill family.

## Standalone evaluation

```bash
# deny
printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"tmux kill-server"},"cwd":"/tmp","session_id":"x"}' \
  | opa eval --format=json -d .cupcake -i /dev/stdin 'data.cupcake.system.evaluate'

# allow
printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"/tmp","session_id":"x"}' \
  | opa eval --format=json -d .cupcake -i /dev/stdin 'data.cupcake.system.evaluate'
```

## Testing

```bash
bun test tests/cupcake
```

This runs the rulebook `tests[]` fixtures plus explicit tmux/pkill/killall scenarios and self-filtering checks against the live `opa` binary.

## Integration with Cupcake

The policy follows the Cupcake custom-policy contract:

1. `# METADATA` block with `scope: package`, `required_events`, `required_tools`.
2. `package cupcake.policies.cc_safety_net_parity`.
3. `import rego.v1`.
4. Decision verbs as `deny contains { ... } if { ... }`.
5. Mandatory self-filtering inside rule bodies (event + tool checks).

To use it inside a Cupcake-enabled project, add this repo as a catalog overlay or copy the `.cupcake/` directory into the target project.

## Known limitations (inherited from the source rulebook)

This policy is a **faithful** port of the active `cc-safety-net` user rulebook, including its token-OR matching semantics. Two consequences:

- `docker compose down` / `docker compose rm` are blocked **regardless of project name**, because the rulebook's `block_args` lists both the verb (`down`/`rm`) and the `--project-name=litellm*` tokens, and `cc-safety-net` matches if ANY token appears. The rulebook's own `tests[]` fixture `docker compose down` expects `blocked`, so this port matches it. The rule names/reasons mention litellm specifically, but the effective behavior is broader. This is faithful, not a regression.
- `block-compose-stop-litellm-services` keys on `--target=litellm*` prefixes only, so it is correctly scoped.

If narrower carve-out semantics are desired later, that is a rulebook change (update `tests/fixtures/user-rules.rulebook.json` first), not a policy-only change.
