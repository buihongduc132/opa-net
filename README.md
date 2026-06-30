# pi-opa-net

OPA-backed bash command guard with structured `--json` output (decision-output.v1 schema). Agent-agnostic, fail-open default, exit-code compatible with the Claude Code hook protocol.

> Scope [LD3]: bash command guarding **only**. Engine [LD1]: OPA/Rego. Topology [LD2]: OPA on every dev box, lazy-loaded. `--json` governs OUTPUT only [LD4] — INPUT stays OPA/Rego.

## Why

Three limitations of asymmetric, agent-specific guard output that this fixes:

1. **Asymmetric** → both allow AND deny emit the full schema (today allow is silent).
2. **No provenance** → `reasons[].rule_id` traces decision → rule → source line.
3. **Agent-specific** → agent-agnostic wrapper; the Claude-Code hook adapter is a thin view.

## Install

```bash
# Requires OPA 1.x on PATH or at ~/.local/share/mise/installs/opa/<ver>/opa
mise install opa@latest
bun install
```

## Usage

```bash
# claude-code mode (default): suppress stdout on allow, JSON on deny
pi-opa-net eval "git stash pop"             # exit 2 + JSON on stdout
pi-opa-net eval "git stash list"            # exit 0, empty stdout

# --json: always emit the full decision-output.v1 schema
pi-opa-net eval "git stash pop" --json

# stdin
echo "docker stop foo" | pi-opa-net eval
```

Exit codes: `0=allow`, `2=deny` (Claude Code hook protocol compatible).

## Output schema

See [`schemas/decision-output.v1.json`](schemas/decision-output.v1.json) (JSON Schema draft 2020-12, strict). Every emitted record is validated against it before leaving the process.

```jsonc
{
  "schema_version": "1.0",
  "decision": "deny",            // allow | deny
  "action": "block",             // allow | block | prompt_user(v2) | log_only(v2)
  "source": "opa",               // opa | fail-open | fail-closed | cached
  "reasons": [                   // every fired deny rule → one entry
    { "rule_id": "block-git-stash-mutations",
      "message": "Do not mutate stashes in shared work...",
      "family": "git", "severity": "block" }
  ],
  "input": { "raw": "git stash pop", "program": "git",
             "subcommand": "stash", "args": ["pop"],
             "parse_confidence": "full" },   // full | partial | regex-only | failed
  "summary": "BLOCKED: git stash pop (rule: block-git-stash-mutations)",
  "suggestions": ["git stash list", "git stash show"],
  "metadata": { "engine": "opa", "opa_version": "1.18.1",
                "rulebook_digest": "dee3746bf7b5", "policy_path": "...",
                "hostname": "bhd-main", "session_id": "ses_abc123" },
  "evaluated_at": "2026-07-01T14:23:45.123Z",
  "decision_id": "7f3a9c2e-1b4d-4e8f-9a2c-5d6e7f8a9b01",
  "duration_ms": 4.2
}
```

## Architecture

Two halves (per the explore findings):

| Half | Responsibility | Module |
|------|----------------|--------|
| **Parse** | raw `"git stash list"` → `{program, subcommand, args, parse_confidence}` | `src/parser/` |
| **Decide** | structured input → allow/deny + reasons | `policy/safety.rego` + `src/engine/` |

```
src/
├── parser/     CommandParserCoordinator (hybrid: ShellQuote AST primary, regex fallback)
├── engine/     OpaCliEngine (subprocess `opa eval` + fail-mode [OT2])
├── rules/      RuleRegistry + catalog (message → rule_id + family provenance)
├── output/     DecisionBuilder (schema assembly) + OutputFormatter (stdout/exit-code)
├── config/     EngineConfig (fail-mode, OPA binary discovery)
├── cli/        run.ts (wires the pipeline)
└── util/       sha256Prefix (rulebook drift detection)
```

### OOP / DRY

- `DecisionEngine` interface → `OpaCliEngine` impl (fakes injectable for tests).
- `CommandParser` interface → AST + regex strategies coordinated.
- `RuleRegistry` is the single source of truth for rule provenance; the catalog mirrors `policy/safety.rego` message-for-message (a parity test fails on drift).

## Fail-mode [OT2]

When OPA is unreachable (cold-start [LD2], binary missing, timeout):

- `PI_OPA_FAIL_MODE=open` (default) → allow, `source: "fail-open"` (matches pi-safety-net fork).
- `PI_OPA_FAIL_MODE=closed` → deny, `source: "fail-closed"`.

The `source` field makes whichever mode fires **observable** per-decision.

## Config (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `PI_OPA_BINARY` | auto (PATH → mise) | OPA binary path |
| `PI_OPA_FAIL_MODE` | `open` | fail-mode [OT2] |
| `PI_OPA_TIMEOUT_MS` | `250` | OPA eval timeout |
| `PI_OPA_HOSTNAME` | `os.hostname()` | metadata.hostname |
| `PI_OPA_SESSION_ID` | `""` | metadata.session_id |

## Develop

```bash
bun test                 # all tests
bun test --coverage      # coverage (line > 97%)
bun run typecheck        # tsc --noEmit
bun run lint             # biome
```

E2E tests run the live CLI against real OPA + the real policy, covering ≥40% of the rule catalog.

## Decisions & open threads

- [`docs/locked-decisions.yaml`](docs/locked-decisions.yaml) — LD1–LD5 (immutable inputs).
- [`docs/open-threads.yaml`](docs/open-threads.yaml) — OT1–OT5 resolved at implementation time.

## License

MIT
