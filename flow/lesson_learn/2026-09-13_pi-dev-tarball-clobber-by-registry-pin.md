# LSL: pi package refresh reinstalled registry 0.6.0 over the 0.7.0 tarball

## Context
Auditor-2 REJECT: `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net` was 0.6.0 (SHA `d75e475…` ≠ source `8608613d`). Live CLI: `du -sh /var` and `find /home/bhd` **allowed** (old policy). Cause: both stages listed `npm:pi-opa-net` in `settings.json` and `pi-opa-net: ^0.6.0` in `npm/package.json`. A later `pi` package refresh reinstalled 0.6.0 from npm because 0.7.0 is not on the registry (the E404 GAP). Proof artifacts from 14:57 claimed 0.7.0 and were stale vs the 17:31 tree.

## Solutions
1. Re-copy 0.7.0 tarball into the stage `node_modules`.
2. Replace `npm:pi-opa-net` with the **local repo path** in both stages' `settings.json`.
3. Pin `npm/package.json` deps to `file:/home/bhd/Documents/Projects/bhd/opa-net`.
Until 0.7.0 is on npm, the `file:` pin is the only way a refresh cannot clobber.

## Gotchas
- Tarball copy into `node_modules` is not durable if settings still say `npm:pkg` and lock says `^0.6.0`.
- Prod can stay 0.7.0 while dev is silently rolled back — always sha256 **both** stages vs source in the same probe.
- Proof JSONL/CLI files timestamped hours earlier are not evidence of *current* live state.

## Ref
flow/findings/2026-09-13-dev-stage-deploy-proof/dev-drift-and-pin.md
~/.pi-dev-pi-plugins/settings.json
~/.pi/agent/settings.json
