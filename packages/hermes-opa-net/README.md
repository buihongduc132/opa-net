# hermes-opa-net

> OPA-backed bash command guard for the Hermes agent ecosystem — structured decision-output.v1 JSON, fail-open default, Hermes pre_tool_call hook.

[![npm version](https://img.shields.io/npm/v/hermes-opa-net?style=flat-square)](https://www.npmjs.com/package/hermes-opa-net)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## Features

- **OPA/Rego policy engine** — 42-rule catalog (cc-safety-net parity)
- **Hermes pre_tool_call hook** — registers on `terminal`, `bash`, `shell` tool names
- **decision-output.v1** — structured JSON output with rule_id, family, severity
- **Fail-open default** — PIOPANET_STRICT=1 for fail-closed
- **Unlock-key capability system** — long-lived + TTL keys per rule
- **Audit sink** — JSONL audit log with secret redaction
- **CLI** — `hermes-opa-net eval "<cmd>" --json`

## Installation

### For Humans

```bash
npm install -g hermes-opa-net
```

### For AI Agents (pi / OpenCode / Claude Code / Codex)

Add to your `settings.json`:

```json
{
  "packages": [
    "hermes-opa-net"
  ]
}
```

## Usage

### CLI

```bash
hermes-opa-net eval "git stash pop" --json
hermes-opa-net eval "git status" --json
hermes-opa-net unlock-key block-git-stash-mutations
hermes-opa-net unlock-key --list
```

### Hermes Plugin

```typescript
import hermesOpaNetExtension from 'hermes-opa-net/src/hermes/index';

// In your Hermes plugin registration:
hermesOpaNetExtension(ctx);
```

The extension:
1. Auto-discovers PIOPANET_HOME (honoring HERMES_OPA_NET_HOME alias)
2. Registers `pre_tool_call` hook on `terminal`/`bash`/`shell` tools
3. Evaluates commands via OPA subprocess
4. Returns `{action: 'block', message}` directive to veto dangerous commands

## Configuration

| Env Var | Purpose |
|---------|---------|
| `OPA_BIN` | Path to OPA binary (default: auto-detect) |
| `PIOPANET_HOME` | Rule/policy config directory |
| `HERMES_OPA_NET_HOME` | Alias for PIOPANET_HOME (Hermes-specific) |
| `HERMES_SESSION_FILE` | Session file path for audit logging |
| `PIOPANET_STRICT` | Set to `1` for fail-closed mode |

## Exit Codes

- `0` — allow
- `2` — deny

## License

MIT
