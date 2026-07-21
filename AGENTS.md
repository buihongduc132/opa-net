# AGENTS.md — opa-net

> AI agent guidance for working on the opa-net project.

## Project Overview

**opa-net** is a **framework** for bash command safety evaluation. It provides:
- OPA/Rego policy engine
- Command parser (hybrid AST + regex fallback)
- Decision output schema (decision-output.v1)
- Fail-mode handling (open/closed)
- Unlock-key capability system

**Plugins** adapt opa-net to specific agent ecosystems:
- `pi-opa-net` — pi extension (this repo, npm package)
- Future: `hermes-opa-net`, `zcode-opa-net`, `agy-opa-net`, `claude-opa-net`, `codex-opa-net`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  opa-net (framework)                                        │
│  - OPA/Rego engine                                          │
│  - 42-rule catalog (cc-safety-net parity)                   │
│  - Unlock-key capability system                             │
│  - Output: decision-output.v1 schema                        │
│  - Fail-mode: open/closed                                   │
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

## Key Principle

**Do NOT reimplement from scratch.** Make opa-net output compatible with existing safety-net implementations, then reuse their hook/adapter logic with our underlying OPA engine.

## Repository Structure

```
opa-net/
├── src/
│   ├── cli/              # CLI entrypoint (run.ts)
│   ├── config/           # Configuration (Config.ts)
│   ├── engine/           # OPA engine wrapper (OpaCliEngine.ts)
│   ├── output/           # Decision builder + formatter
│   ├── parser/           # Command parser (hybrid AST + regex)
│   ├── rules/            # Rule catalog + registry
│   ├── unlock/           # Unlock-key capability system
│   └── audit/            # Audit sink interface
├── policy/
│   └── safety.rego       # OPA/Rego policy (42 rules)
├── schemas/
│   └── decision-output.v1.json
├── tests/
│   ├── unit/
│   ├── e2e/
│   └── fixtures/
├── flow/
│   ├── findings/         # Explore session artifacts
│   └── requirements/     # Plugin requirements
│       └── plugins/      # Plugin-specific requirements
├── openspec/
│   └── changes/          # OpenSpec change artifacts
└── docs/                 # Documentation
```

## Commands

```bash
# Install dependencies
bun install

# Run tests (304 tests)
bun test

# Typecheck
bun run typecheck

# Lint
bun run lint

# Smoke test
bun run smoke

# CLI usage
pi-opa-net eval "git stash pop" --json
pi-opa-net unlock-key block-git-stash-mutations
pi-opa-net unlock-key --list
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli/run.ts` | CLI entrypoint, orchestrates parse → evaluate → build → emit |
| `src/engine/OpaCliEngine.ts` | OPA subprocess wrapper, fail-mode handling |
| `src/parser/CommandParser.ts` | Hybrid parser (ShellQuote AST + regex fallback) |
| `src/rules/catalog.ts` | 42-rule catalog (cc-safety-net parity) |
| `src/unlock/` | Unlock-key capability system (KeyDerivation, KeyParser, KeyVerifier, UnlockFilter, SaltResolver) |
| `src/audit/AuditSink.ts` | Audit sink interface (NoOpSink default) |
| `policy/safety.rego` | OPA/Rego policy (42 rules) |
| `schemas/decision-output.v1.json` | Output schema (additive, stays v1) |

## Locked Decisions

All design decisions are locked in `flow/findings/2026-07-20-rule-unlock-keys/2026-07-20-locked-decisions.yaml`:

- **LD-L1**: Per-rule granularity (one rule = one key)
- **LD-L2**: No god-key (refuse PIOPANET_UNLOCK_ALL)
- **LD-L3**: Two lifetimes (LL + TTL) via self-describing prefix
- **LD-L4**: Delivery = ENV + --unlock + --unlock-stdin
- **LD-L6**: TS-side post-eval filter (keys never enter OPA)
- **LD-Y1**: Deploy-local salt + env override seam
- **LD-Y2**: Decision-record-only audit + NoOp sink seam
- **LD-G1**: Fail-open+keys → source:fail-open-keyless
- **LD-G2**: --unlock-stdin requires positional command
- **LD-G3**: cacheTtlMs forced 0 when keys present
- **LD-G6**: All-or-nothing multi-rule semantics
- **LD-G8**: Filter crash → fall back to un-filtered decision

## Plugin Development

See `flow/requirements/plugins/README.md` for plugin architecture and requirements.

### Current Plugin: pi-opa-net

This repo (`pi-opa-net`) is the pi extension. See `flow/requirements/plugins/pi-opa-net.md` for implementation details.

**Key points:**
- Translates `decision-output.v1` → safety-net format
- Implements pi's `tool_call` hook
- Reuses pi-safety-net's hook interface
- Preserves fail-mode, unlock-key, audit semantics

### Future Plugins

- `hermes-opa-net` — Hermes plugin
- `zcode-opa-net` — ZCode plugin
- `agy-opa-net` — Agy adapter
- `claude-opa-net` — Claude Code hook
- `codex-opa-net` — Codex CLI integration

## Testing

```bash
# Full test suite (304 tests)
bun test

# Specific test files
bun test tests/unit/unlock/
bun test tests/e2e/unlock-flow.test.ts

# Coverage
bun test --coverage
```

## Deployment

```bash
# Publish to npm
npm publish --access public

# Install globally
npm install -g pi-opa-net

# Install in pi
pi install pi-opa-net
```

## References

- [pi-safety-net](https://github.com/buihongduc132/pi-safety-net) — reference pi extension
- [cc-safety-net](https://github.com/anthropics/cc-safety-net) — upstream
- [OPA](https://www.openpolicyagent.org/) — policy engine
- [decision-output.v1](schemas/decision-output.v1.json) — output schema
- [unlock-keys design](flow/findings/2026-07-20-rule-unlock-keys/) — capability system

## License

MIT
