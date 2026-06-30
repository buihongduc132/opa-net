# Contributing to pi-opa-net

Thanks for your interest in improving pi-opa-net. This is a small, focused package — keep changes scoped.

## Prerequisites

- [Bun](https://bun.sh) >= 1.1
- [OPA](https://www.openpolicyagent.org) 1.x on `PATH` (recommended via `mise install opa@latest`)
- Node 22+ (for the GitHub Actions CI matrix)

## Setup

```bash
git clone https://github.com/buihongduc132/pi-opa-net.git
cd pi-opa-net
bun install
```

## Development loop

```bash
bun test                  # run all tests
bun test --coverage       # with coverage (gate: lines > 80%)
bun run typecheck         # tsc --noEmit (strict)
bun run lint              # biome check --write
bun run check             # typecheck + lint:ci + test:coverage (the full gate)
bun run smoke             # one-shot CLI check against live OPA
```

The full gate (`bun run check`) must pass before a PR is mergeable.

## Adding a rule

1. Add a `deny[msg] if { ... }` block to [`policy/safety.rego`](policy/safety.rego).
2. Add the matching entry to [`src/rules/catalog.ts`](src/rules/catalog.ts) — same `message` string, plus `ruleId`, `family`, and optional `suggestions`.
3. The catalog↔rego parity test (`tests/unit/rules/catalog-parity.test.ts`) will fail if the two drift. Keep them in sync.
4. Add an E2E case to [`tests/e2e/e2e.test.ts`](tests/e2e/e2e.test.ts) if the rule is deny-able.

## Commit style

Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Keep the subject ≤72 chars.

## Scope

This package is **bash command guarding only** ([LD3](docs/locked-decisions.yaml)). Do not add OPA policy for other domains (deploy-gating, API authz, k8s) — those belong in their own packages. The pi extension wiring (tool_call hook) is a separate future repo ([OT5](docs/open-threads.yaml)).

## Reporting issues

Use [GitHub Issues](https://github.com/buihongduc132/pi-opa-net/issues). For security reports, see [SECURITY.md](SECURITY.md).
