# LSL: publish job — no OPA, then step-scoped NODE_AUTH_TOKEN too late, then E404 write scope

## Context
Three stacked publish failures after PR #13 merge:

1. `prepublishOnly` → `bun run check` → `bun test`. Publish job had no `setup-opa` → `Executable not found in $PATH: opa` (unlock-flow + cupcake-parity).
2. After adding OPA: `ENEEDAUTH`. `NODE_AUTH_TOKEN` was **step-scoped** on `npm publish`. `actions/setup-node` with `registry-url` writes `.npmrc` at *its* step, when the token is not yet in env → empty auth.
3. After job-scoping the token: provenance signed, then `E404 PUT /pi-opa-net`. Token authenticates (`/whoami` → `{}`) but lacks **write** on the existing unscoped package. BW item `npm - bhd main public` and GitHub `NPM_TOKEN` are the same class of 40-char `npm_…` token.

## Solutions
- Publish job: `setup-opa` + job-level `env.NODE_AUTH_TOKEN`.
- E404 is **not** a code bug. Human must mint a publish-scoped automation/granular token with `pi-opa-net` write, put it in GitHub `NPM_TOKEN` + BW. Workflow is ready. Documented in `npm-publish-blocker.md`. Until then, machine deploy uses local tarball + `file:` pin.

## Gotchas
- `setup-node` `registry-url` interpolates `NODE_AUTH_TOKEN` at setup-node time, not at publish time.
- Provenance/OIDC (`id-token: write`) signs the statement; it does **not** grant PUT permission. Trusted publishers still need a one-time npmjs.com bind.
- `npm whoami` 401 vs `{}`: 401 = rejected; `{}` = authenticated with no user read scope (typical automation token). E404 on PUT still means no write.

## Ref
.github/workflows/ci.yml (publish job)
flow/findings/2026-09-13-dev-stage-deploy-proof/npm-publish-blocker.md
