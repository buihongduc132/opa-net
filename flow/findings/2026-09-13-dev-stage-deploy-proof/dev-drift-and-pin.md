# pi-dev 0.6.0 drift (2026-09-13 17:31) and pin

Auditor-2 REJECT: `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net` had
been overwritten back to registry `0.6.0` (policy SHA `d75e475be056` ≠
source `8608613dbd7e`). Cause: both stages listed `npm:pi-opa-net` in
`settings.json` and `pi-opa-net: ^0.6.0` in `npm/package.json`. A later
`pi` package refresh reinstalled 0.6.0 from npm (0.7.0 is not on the
registry — documented GAP).

## Fix (applied 2026-09-13)

1. Re-copied 0.7.0 tarball into
   `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net`
   (SHA 8608613d matches source).
2. Replaced `npm:pi-opa-net` with the local repo path
   `/home/bhd/Documents/Projects/bhd/opa-net` in:
   - `~/.pi-dev-pi-plugins/settings.json`
   - `~/.pi/agent/settings.json`
3. Pinned `npm/package.json` deps to
   `file:/home/bhd/Documents/Projects/bhd/opa-net` in both stages.

Until a publish-scoped npm token lands 0.7.0 on the registry, the local
path pin is the only way a package refresh cannot clobber the deploy.

## Re-probe after pin

```
git stash pop => deny | block-git-stash-mutations | v0.7.0 | digest 8608613d
du -sh /var   => deny | block-shallow-heavy-scan  | v0.7.0 | digest 8608613d
eza -T -L 2 . => allow | v0.7.0
git status    => allow | v0.7.0
```
