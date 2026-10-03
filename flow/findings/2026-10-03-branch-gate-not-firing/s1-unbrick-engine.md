# S1 Verification Record — Engine Unbrick (F1)

- Date: 2026-10-03
- Issue: `Cannot find module './core' from '.../ajv/dist/ajv.js'` broke all evals and caused fail-open.
- Fix:
  1. Ran `bun install --force` to ensure `node_modules` in repo and stage-1 are complete with `ajv/dist/core.js`.
  2. Fixed `resolveRaw` in `src/cli/run.ts` so `opts.command !== undefined` does not fall through to `fs.readFileSync(0)` when given an empty command string.
  3. Re-verified `ajv/dist/core.js` exists across all roots:
     - Repo: `node_modules/ajv/dist/core.js` (exists)
     - Stage-1: `~/.pi/agent/packages/opa-net/node_modules/ajv/dist/core.js` (exists)
     - Global CLI: `~/.local/share/mise/installs/node/22.22.2/lib/node_modules/pi-opa-net/node_modules/ajv/dist/core.js` (exists)
  4. Ran `eval "git stash pop" --json` from both roots:
     - Global CLI: returns exit 2 + real deny decision JSON (`block-git-stash-mutations`).
     - Stage-1: returns exit 2 + real deny decision JSON (`block-git-stash-mutations`).
