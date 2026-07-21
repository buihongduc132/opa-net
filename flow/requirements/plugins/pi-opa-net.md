# pi-opa-net Plugin Requirements

## Overview

`pi-opa-net` is the pi extension that adapts the opa-net framework to pi's tool_call hook system. It replaces pi-safety-net with an OPA-backed engine while preserving the same hook interface and output contract.

## Goal

Install `pi-opa-net` via `pi install pi-opa-net`. Bash commands intercepted by pi's tool_call hook → evaluated by opa-net → decision returned in safety-net format.

## Non-Goals

- Reimplementing cc-safety-net's rule matcher (we use OPA/Rego)
- Reimplementing pi's hook system (we use the existing tool_call hook)
- Reimplementing the output formatter (we translate opa-net → safety-net format)

## Compatibility Contract

### Output Translation

opa-net emits `decision-output.v1`. pi-safety-net expects safety-net format. The adapter translates:

| opa-net field | safety-net field | Notes |
|---------------|------------------|-------|
| `decision: "deny"` | `{allow: false, reason: ...}` | deny = block |
| `decision: "allow"` | `{allow: true}` | allow = pass |
| `source: "opa"` | (implicit) | normal evaluation |
| `source: "opa-unlocked"` | `{allow: true, unlocked: true}` | capability bypass |
| `source: "fail-open"` | `{allow: true, failMode: "open"}` | OPA unreachable |
| `source: "fail-open-keyless"` | `{allow: true, failMode: "open", keyless: true}` | OPA down + keys |
| `source: "unlock-filter-error"` | `{allow: false, error: "filter-crash"}` | filter crash → deny |
| `reasons[].rule_id` | `reason.rule_id` | provenance |
| `reasons[].message` | `reason.message` | human message |
| `metadata.unlock_count` | (logged in extension context) | audit |
| `metadata.unlock_agent` | (logged in extension context) | audit |

### Exit Codes

| opa-net exit | pi hook behavior |
|--------------|------------------|
| 0 (allow) | hook passes (command executes) |
| 2 (deny) | hook blocks (command rejected) |

### Fail-Mode

- `PI_OPA_FAIL_MODE=open` (default) → fail-open (never brick shell)
- `PI_OPA_FAIL_MODE=closed` → fail-closed (block on OPA error)

## Plugin Structure

```
pi-opa-net/                          (this repo, npm package)
├── package.json
├── src/
│   ├── index.ts                     (extension entry — registers hook)
│   ├── tool-call.ts                 (hook implementation)
│   ├── adapter.ts                   (opa-net output → safety-net format)
│   └── config.ts                    (env parsing, defaults)
├── tests/
│   ├── tool-call.test.ts            (hook unit tests)
│   ├── adapter.test.ts              (translation unit tests)
│   └── e2e.test.ts                  (full flow)
└── README.md
```

### Hook Implementation

```typescript
// src/tool-call.ts
import { runCli } from 'pi-opa-net';

export function toolCallHook(input: ToolCallInput): ToolCallResult {
  const command = input.tool_input.command;
  const result = runCli({ command, mode: 'claude-code' });

  if (result.exitCode === 2) {
    // deny
    return {
      allow: false,
      reason: JSON.parse(result.stdout).reasons[0]?.message ?? 'blocked by opa-net',
    };
  }

  // allow (exit 0)
  return { allow: true };
}
```

### Adapter Implementation

```typescript
// src/adapter.ts
import type { DecisionOutput } from 'pi-opa-net';

export interface SafetyNetResult {
  allow: boolean;
  reason?: string;
  ruleId?: string;
  unlocked?: boolean;
  failMode?: 'open' | 'closed';
}

export function adapt(decision: DecisionOutput): SafetyNetResult {
  if (decision.decision === 'allow') {
    return {
      allow: true,
      unlocked: decision.source === 'opa-unlocked',
      failMode: decision.source.startsWith('fail-open') ? 'open' : undefined,
    };
  }

  // deny
  const reason = decision.reasons[0];
  return {
    allow: false,
    reason: reason?.message,
    ruleId: reason?.rule_id,
  };
}
```

## Configuration

### Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PI_OPA_FAIL_MODE` | `open` | fail-mode |
| `PI_OPA_BINARY` | auto (PATH → mise) | OPA binary path |
| `PI_OPA_TIMEOUT_MS` | `250` | OPA eval timeout |
| `PIOPANET_UNLOCK_KEYS` | (none) | unlock keys (comma-separated) |
| `PIOPANET_AGENT_ID` | (none) | agent identifier for audit |

### Pi Settings

```jsonc
// settings.json
{
  "extensions": ["pi-opa-net"],
  "env": {
    "PI_OPA_FAIL_MODE": "open"
  }
}
```

## Testing Requirements

### Unit Tests

1. **adapter.test.ts**
   - allow decision → `{allow: true}`
   - deny decision → `{allow: false, reason, ruleId}`
   - opa-unlocked → `{allow: true, unlocked: true}`
   - fail-open → `{allow: true, failMode: 'open'}`
   - unlock-filter-error → `{allow: false}`

2. **tool-call.test.ts**
   - bash command → hook called
   - deny exit → hook blocks
   - allow exit → hook passes
   - OPA missing → fail-open (hook passes)

### Integration Tests

1. **Live OPA + policy**
   - Run hook against real commands
   - Verify rule firing (e.g., `git stash pop` → deny)

### E2E Tests

1. **Full flow**
   - `pi install pi-opa-net`
   - Run pi session
   - Execute blocked command
   - Verify hook intercepts

## Success Criteria

1. `pi install pi-opa-net` succeeds
2. Hook registered: bash tool calls intercepted
3. `git stash pop` → blocked with reason
4. `git status` → allowed
5. Unlock key → bypassed
6. OPA missing → fail-open (no brick)
7. No regressions vs pi-safety-net

## References

- [pi-safety-net](https://github.com/buihongduc132/pi-safety-net) — reference pi extension
- [pi extension docs](https://pi.dev/docs/latest/extensions)
- [opa-net output schema](../../schemas/decision-output.v1.json)
- [unlock-keys design](../../flow/findings/2026-07-20-rule-unlock-keys/)
