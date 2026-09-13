# Changelog

## 0.1.0 (2026-07-22)

### Features

- Hermes plugin adapter for opa-net
- pre_tool_call hook for terminal/bash/shell tools
- decision-output.v1 → Hermes-canonical {action:'block', message} translation
- Fail-open default (PIOPANET_STRICT=1 for fail-closed)
- Unlock-key capability system passthrough
- JSONL audit sink with secret redaction
- CLI: `hermes-opa-net eval "<cmd>" --json`
- Auto-discovery of PIOPANET_HOME (HERMES_OPA_NET_HOME alias)
