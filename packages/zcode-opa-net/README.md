# zcode-opa-net

> OPA-backed bash command guard for the ZCode (zai) agent ecosystem — structured decision-output.v1 JSON, fail-open default, ZCode PreToolUse command hook.

[![npm version](https://img.shields.io/npm/v/zcode-opa-net?style=flat-square)](https://www.npmjs.com/package/zcode-opa-net)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## Features

- **OPA/Rego policy engine** — 42-rule catalog (cc-safety-net parity)
- **ZCode PreToolUse command hook** — Claude-Code-compatible lifecycle hook
- **decision-output.v1** — structured JSON output with rule_id, family, severity
- **Fail-open default** — PIOPANET_STRICT=1 for fail-closed
- **Unlock-key capability system** — long-lived + TTL keys per rule
- **Audit sink** — JSONL audit log with secret redaction
- **CLI** — `zcode-opa-net eval "<cmd>" --json`

## Installation

### For Humans

```bash
npm install -g zcode-opa-net
```

### For ZCode Plugin Registration

Add to your ZCode plugin's `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${ZCODE_PLUGIN_ROOT}/bin/zcode-opa-net.js hook",
            "timeoutMs": 30000
          }
        ]
      }
    ]
  }
}
```

## Usage

### CLI

```bash
zcode-opa-net eval "git stash pop" --json
zcode-opa-net eval "git status" --json
zcode-opa-net unlock-key block-git-stash-mutations
zcode-opa-net unlock-key --list
```

### Hook Script

```typescript
import { runHookScript } from 'zcode-opa-net/src/zcode/index';

// In your ZCode hook entry:
await runHookScript();
```

The hook:
1. Reads PreToolUse payload from stdin: `{hookEventName, cwd, sessionId, toolName, toolInput:{command}}`
2. Auto-discovers PIOPANET_HOME (honoring ZCODE_OPA_NET_HOME alias)
3. Evaluates commands via OPA subprocess
4. Writes `{hookSpecificOutput:{permissionDecision:'deny', permissionDecisionReason}}` to stdout on deny, `{}` on allow

## Configuration

| Env Var | Purpose |
|---------|---------|
| `OPA_BIN` | Path to OPA binary (default: auto-detect) |
| `PIOPANET_HOME` | Rule/policy config directory |
| `ZCODE_OPA_NET_HOME` | Alias for PIOPANET_HOME (ZCode-specific) |
| `ZCODE_SESSION_FILE` | Session file path for audit logging |
| `PIOPANET_STRICT` | Set to `1` for fail-closed mode |

## Exit Codes

- `0` — allow
- `2` — deny

## License

MIT
