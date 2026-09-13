# npm-publish blocker (external credential)

> 2026-09-13 · after PR #13 merge · CI publish job E404

## What works

- CI verify (ubuntu + macos) + package-dry-run: SUCCESS
- `prepublishOnly` (typecheck + lint + bun test): SUCCESS in the publish job
- Provenance signing: SUCCESS (sigstore log index 2816054826)
- Token authenticates (NODE_AUTH_TOKEN is set; npm reaches PUT)

## What fails

```
npm error 404 Not Found - PUT https://registry.npmjs.org/pi-opa-net
npm error 404  'pi-opa-net@0.7.0' is not in this registry.
```

This is npm's standard response when the token is authenticated but **lacks write/publish permission** for the package. `pi-opa-net` is owned by `buihongduc132` (npm view maintainers). The stored token (`npm - bhd main public` in BW, GitHub secret `NPM_TOKEN`) is a 40-char `npm_…` token that authenticates (`/whoami` → `{}`) but cannot PUT.

## Required human action

Mint a **publish-scoped** npm token as `buihongduc132`:

1. npmjs.com → Access Tokens → Generate new token
   - Type: **Automation** (or granular with `pi-opa-net` **Read and write**)
2. Put the token in:
   - GitHub secret `NPM_TOKEN` on `buihongduc132/opa-net`
   - Bitwarden item `npm - bhd main public` (replace the expired 40-char token)
3. Re-run the latest main CI (or push an empty commit). The publish job will then succeed — no code changes needed.

## Deploy status (independent of npm registry)

- **dev**: `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net` = 0.7.0, policy SHA 8608613d matches source
- **prod (current machine)**: `~/.pi/agent/npm/node_modules/pi-opa-net` = 0.7.0, same SHA
- **pi-session proof**: `prod-pi-session-results.txt` — git stash pop + `du -sh /var` BLOCKED, eza + git status ALLOWED
