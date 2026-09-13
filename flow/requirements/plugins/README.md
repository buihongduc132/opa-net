# opa-net Plugin Architecture Requirements

## Overview

opa-net is a **framework** for bash command safety evaluation. It provides:
- OPA/Rego policy engine
- Command parser (hybrid AST + regex fallback)
- Decision output schema (decision-output.v1)
- Fail-mode handling (open/closed)
- Unlock-key capability system

**Plugins** adapt opa-net to specific agent ecosystems (pi, hermes, zcode, agy, claude, codex).

## Architecture Principle

**Do NOT reimplement from scratch.** Make opa-net output compatible with existing safety-net implementations, then reuse their hook/adapter logic with our underlying OPA engine.

### Compatibility Strategy

```
┌─────────────────────────────────────────────────────────────┐
│  cc-safety-net / pi-safety-net (existing)                   │
│  - Hook interface: PreToolUse, tool_call                    │
│  - Output format: {decision, reason, ...}                   │
│  - Fail-mode: open/closed                                   │
└─────────────────────────────────────────────────────────────┘
                            ↑
                            │ REUSE
                            │
┌─────────────────────────────────────────────────────────────┐
│  opa-net (our framework)                                    │
│  - OPA/Rego engine                                          │
│  - 42-rule catalog                                          │
│  - Unlock-key capability                                    │
│  - Output: decision-output.v1 schema                        │
└─────────────────────────────────────────────────────────────┘
                            ↑
                            │ ADAPT
                            │
┌─────────────────────────────────────────────────────────────┐
│  Plugin: pi-opa-net / hermes-opa-net / ...                  │
│  - Translate opa-net output → safety-net format             │
│  - Implement agent-specific hook interface                  │
│  - Wire into agent's extension system                       │
└─────────────────────────────────────────────────────────────┘
```

## Plugin List

### Current

| Plugin | Agent | Status | Repo |
|--------|-------|--------|------|
| pi-opa-net | pi | **planned** | buihongduc132/pi-opa-net (this repo) |

### Future

| Plugin | Agent | Status | Notes |
|--------|-------|--------|-------|
| hermes-opa-net | hermes | planned | Hermes extension system |
| zcode-opa-net | zcode | planned | ZCode plugin interface |
| agy-opa-net | agy | planned | Agy adapter |
| claude-opa-net | claude | planned | Claude Code hook |
| codex-opa-net | codex | planned | Codex CLI integration |

## Plugin Requirements

### Common (all plugins)

1. **Output Compatibility**
   - Translate `decision-output.v1` → safety-net format
   - Preserve: decision (allow/deny), reason, rule_id, severity
   - Map: `source` field (opa, opa-unlocked, fail-open, etc.)
   - Handle: unlock-key metadata (bypassed, unlock_key_id)

2. **Hook Interface**
   - Implement agent-specific hook (PreToolUse, tool_call, etc.)
   - Intercept bash commands before execution
   - Return: allow/deny decision + reason
   - Handle: fail-mode (open/closed) consistently

3. **Configuration**
   - Policy path (default: `policy/safety.rego`)
   - Fail-mode (default: open)
   - OPA binary path (auto-detect or explicit)
   - Unlock keys (env, CLI, stdin)
   - Agent ID (for audit)

4. **Testing**
   - Unit tests: output translation
   - Integration tests: hook invocation
   - E2E tests: full flow (command → decision → agent response)

### pi-opa-net Specific

1. **Extension Type**: pi package (npm)
2. **Hook**: `tool_call` (PreToolUse equivalent)
3. **Package Structure**:
   ```
   pi-opa-net/
   ├── package.json (pi extension metadata)
   ├── src/
   │   ├── index.ts (extension entry)
   │   ├── tool-call.ts (hook implementation)
   │   └── adapter.ts (opa-net → safety-net translation)
   └── README.md
   ```
4. **Integration**:
   - Install: `pi install pi-opa-net`
   - Config: `settings.json` → `extensions: ["pi-opa-net"]`
   - Hook: intercept `bash` tool calls

### hermes-opa-net Specific

1. **Extension Type**: Hermes plugin
2. **Hook**: Hermes tool-call interface
3. **Integration**: Hermes plugin system (TBD)

### zcode-opa-net Specific

1. **Extension Type**: ZCode plugin
2. **Hook**: ZCode command interception
3. **Integration**: ZCode plugin API (TBD)

### agy-opa-net Specific

1. **Extension Type**: Agy adapter
2. **Hook**: Agy command filter
3. **Integration**: Agy adapter interface (TBD)

### claude-opa-net Specific

1. **Extension Type**: Claude Code hook
2. **Hook**: PreToolUse (native Claude Code hook)
3. **Integration**: Claude Code extension system

### codex-opa-net Specific

1. **Extension Type**: Codex CLI plugin
2. **Hook**: Codex command filter
3. **Integration**: Codex CLI extension API (TBD)

## Implementation Priority

1. **pi-opa-net** (first, reference implementation)
   - Most mature agent ecosystem
   - Clear hook interface (tool_call)
   - Existing pi-safety-net as reference

2. **claude-opa-net** (second)
   - Native PreToolUse hook
   - Similar to pi's tool_call

3. **hermes-opa-net** (third)
   - Hermes ecosystem growing
   - Plugin system documented

4. **Others** (as needed)
   - zcode, agy, codex
   - Implement when agent ecosystem matures

## Compatibility Matrix

| Agent | Hook Type | Output Format | Fail-Mode | Unlock-Keys |
|-------|-----------|---------------|-----------|-------------|
| pi | tool_call | safety-net | open/closed | env/CLI/stdin |
| hermes | plugin | safety-net | open/closed | env/CLI/stdin |
| zcode | plugin | safety-net | open/closed | env/CLI/stdin |
| agy | adapter | safety-net | open/closed | env/CLI/stdin |
| claude | PreToolUse | safety-net | open/closed | env/CLI/stdin |
| codex | plugin | safety-net | open/closed | env/CLI/stdin |

## Success Criteria

1. **pi-opa-net** installed via `pi install pi-opa-net`
2. **Hook active**: bash commands intercepted
3. **Decisions correct**: allow/deny matches opa-net engine
4. **Fail-mode works**: open/closed behavior preserved
5. **Unlock-keys work**: capability-based bypass functional
6. **Audit trail**: decision records include unlock metadata

## References

- [pi-safety-net](https://github.com/buihongduc132/pi-safety-net) — reference implementation
- [cc-safety-net](https://github.com/anthropics/cc-safety-net) — upstream
- [decision-output.v1](../../schemas/decision-output.v1.json) — opa-net output schema
- [unlock-keys](../findings/2026-07-20-rule-unlock-keys/) — capability system design
