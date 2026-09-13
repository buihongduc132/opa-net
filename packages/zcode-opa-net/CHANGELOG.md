# Changelog

## 0.1.0 (2026-07-22)

### Features

- ZCode (zai) plugin adapter for opa-net
- PreToolUse command-type hook (stdin/stdout JSON)
- decision-output.v1 → ZCode-canonical {hookSpecificOutput:{permissionDecision:'deny', permissionDecisionReason}} translation
- Fail-open default (PIOPANET_STRICT=1 for fail-closed)
- Unlock-key capability system passthrough
- JSONL audit sink with secret redaction
- CLI: `zcode-opa-net eval "<cmd>" --json`
- Auto-discovery of PIOPANET_HOME (ZCODE_OPA_NET_HOME alias)
