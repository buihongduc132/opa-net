# pi-opa-net

[![npm version](https://img.shields.io/npm/v/pi-opa-net)](https://www.npmjs.com/package/pi-opa-net)
[![CI](https://github.com/buihongduc132/pi-opa-net/actions/workflows/ci.yml/badge.svg)](https://github.com/buihongduc132/pi-opa-net/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> OPA-backed bash command guard for the [Pi](https://pi.dev) ecosystem. Structured `--json` output (decision-output.v1 schema), fail-open default, exit-code compatible with the Claude Code hook protocol.

An **agent-agnostic** engine + CLI that evaluates shell commands against an [OPA](https://www.openpolicyagent.org/)/Rego policy and emits a strict, auditable decision record. Designed as the decision backend for pi extensions, Claude Code hooks, scripts, and any agent that needs a uniform bash-guard contract.

## Why

Three limitations of today's asymmetric, agent-specific guard output that this fixes:

| # | Limitation | Fix |
|---|------------|-----|
| 1 | **Asymmetric** — allow is silent, deny emits a string | Both allow AND deny emit the full schema |
| 2 | **No provenance** — only a human message | `reasons[].rule_id` traces decision → rule → source line |
| 3 | **Agent-specific** — tied to one hook protocol | Agent-agnostic wrapper; adapters become thin views |

## Status

- **Stable:** v0.1.0 — schema v1.0, 42-rule catalog, full TDD coverage
  - Cupcake-compatible policy: `.cupcake/policies/claude/cc_safety_net_parity.rego` (all 42 active `cc-safety-net` rules in OPA/Rego v1)
- **Engine:** OPA 1.x (lazy-loaded on every dev box)
- **Scope:** bash command guarding only (see [`docs/locked-decisions.yaml`](docs/locked-decisions.yaml) LD3)
- **Context signals:** `input.signals.git` feeds a conditional branch-protection gate — deny `git checkout/switch` off a protected branch (see [`docs/signals.md`](docs/signals.md)). Configurable via `PIOPANET_PROTECTED_BRANCHES`.
- **Pi extension:** the thin tool_call adapter lives in a separate future repo (`pi-opa-net-ext`, per OT5) — this package is the engine + library

## Installation

### Prerequisites

OPA 1.x on `PATH` (recommended via [mise](https://mise.jdx.dev)):

```bash
mise install opa@latest
mise use -g opa@latest
```

### Install

```bash
# as a library (pi extension / script consumer)
npm install pi-opa-net
# or
bun add pi-opa-net

# run the CLI directly via bun
bunx pi-opa-net eval "git stash pop"
```

## Usage

### CLI

```bash
# claude-code mode (default): suppress stdout on allow, JSON on deny
pi-opa-net eval "git stash pop"             # exit 2 + JSON on stdout
pi-opa-net eval "git stash list"            # exit 0, empty stdout

# --json: always emit the full decision-output.v1 schema
pi-opa-net eval "git stash pop" --json

# stdin
echo "docker stop foo" | pi-opa-net eval
```

**Exit codes:** `0 = allow`, `2 = deny` (Claude Code hook protocol compatible).

### Programmatic API

```ts
import { configFromEnv, CommandParserCoordinator, OpaCliEngine, DecisionBuilder, OutputFormatter, RULES, RuleRegistry } from 'pi-opa-net';

const config = configFromEnv('/path/to/safety.rego');
const parser = new CommandParserCoordinator();
const engine = new OpaCliEngine(config);
const builder = new DecisionBuilder({
  config,
  registry: new RuleRegistry(RULES),
  digest: engine.rulebookDigest(),
});

const parsed = parser.parse('git stash pop');
const engineDecision = await engine.evaluate(parsed);
const output = builder.build(parsed, engineDecision);

console.log(output.decision);  // 'deny'
console.log(output.reasons[0].rule_id);  // 'block-git-stash-mutations'
```

## Output schema

See [`schemas/decision-output.v1.json`](schemas/decision-output.v1.json) — JSON Schema draft 2020-12, strict (`additionalProperties: false` throughout). Every emitted record is validated against it before leaving the process.

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
                "hostname": "box", "session_id": "" },
  "evaluated_at": "2026-07-01T14:23:45.123Z",
  "decision_id": "7f3a9c2e-1b4d-4e8f-9a2c-5d6e7f8a9b01",
  "duration_ms": 4.2
}
```

## Architecture

Two halves (per the design findings):

| Half | Responsibility | Module |
|------|----------------|--------|
| **Parse** | raw `"git stash list"` → `{program, subcommand, args, parse_confidence}` | `src/parser/` |
| **Decide** | structured input → allow/deny + reasons | `policy/safety.rego` + `src/engine/` |

```
src/
├── parser/     CommandParserCoordinator (hybrid: ShellQuote AST primary, regex fallback)
├── engine/     OpaCliEngine (subprocess `opa eval` + fail-mode)
├── rules/      RuleRegistry + catalog (message → rule_id + family provenance)
├── output/     DecisionBuilder (schema assembly) + OutputFormatter (stdout/exit-code)
├── config/     EngineConfig (fail-mode, OPA binary discovery)
├── cli/        run.ts (wires the pipeline)
└── util/       sha256Prefix (rulebook drift detection)
```

### Design principles

- **OOP** — `DecisionEngine` and `CommandParser` interfaces; fakes injectable for tests.
- **DRY** — `RuleRegistry` is the single source of truth for rule provenance; the catalog mirrors `policy/safety.rego` message-for-message (a parity test fails on drift).
- **Observable** — the `source` field makes fail-mode (open/closed) auditable per-decision; `parse_confidence` surfaces parser fidelity.

## Fail-mode

When OPA is unreachable (cold-start, binary missing, timeout):

| Mode | Behavior | `source` field |
|------|----------|----------------|
| `open` (default) | allow the command through | `fail-open` |
| `closed` | block the command | `fail-closed` |

```bash
PI_OPA_FAIL_MODE=closed pi-opa-net eval "git stash pop"
```

The default `open` matches the [`pi-safety-net`](https://www.npmjs.com/package/pi-safety-net) fork's "never brick the shell" guarantee.

## Configuration (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `PI_OPA_BINARY` | auto (PATH → mise) | OPA binary path |
| `PI_OPA_FAIL_MODE` | `open` | fail-mode |
| `PI_OPA_TIMEOUT_MS` | `250` | OPA eval timeout |
| `PI_OPA_HOSTNAME` | `os.hostname()` | metadata.hostname |
| `PI_OPA_SESSION_ID` | `""` | metadata.session_id |
| `PIOPANET_PROTECTED_BRANCHES` | `main,staging,dev,test,master` | branches the branch-protection gate guards. `""` disables the rule. |

## Develop

```bash
bun install
bun test                 # all tests (106)
bun test --coverage      # coverage (line > 98%)
bun run typecheck        # tsc --noEmit
bun run lint             # biome
bun run smoke            # one-shot CLI check
```

E2E tests run the live CLI against real OPA + the real policy, covering ≥40% of the 42-rule catalog.

## Cupcake-compatible policy

This repo also ships a Cupcake-format OPA/Rego policy at `.cupcake/policies/claude/cc_safety_net_parity.rego` that ports all 42 active `cc-safety-net` user rules. It can be evaluated directly by OPA or consumed as a Cupcake catalog overlay. See [`docs/cupcake-parity.md`](docs/cupcake-parity.md) for details, including the standalone `opa eval` examples and the input/output contract.

## Decisions & open threads

- [`docs/locked-decisions.yaml`](docs/locked-decisions.yaml) — LD1–LD5 (immutable inputs).
- [`docs/open-threads.yaml`](docs/open-threads.yaml) — OT1–OT5 resolved at implementation time.
- [`docs/signals.md`](docs/signals.md) — context signals contract + how to add a new signal collector.
- [`docs/cupcake-parity.md`](docs/cupcake-parity.md) — Cupcake-format policy documentation + standalone `opa eval` usage.

## Project health

- **Security policy:** [`SECURITY.md`](SECURITY.md)
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Support:** [`SUPPORT.md`](SUPPORT.md)
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md)

## Related

- [`pi-safety-net`](https://www.npmjs.com/package/pi-safety-net) — the fail-open fork of cc-safety-net (Path A: non-pi agents). pi-opa-net is Path B (OPA-backed, structured output).
- [`cc-safety-net`](https://www.npmjs.com/package/cc-safety-net) — upstream Claude Code safety net.

## License

MIT © [buihongduc132](https://github.com/buihongduc132)
