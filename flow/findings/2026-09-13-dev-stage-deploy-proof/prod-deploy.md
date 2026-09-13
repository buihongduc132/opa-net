# Prod-stage (current machine) deploy — 2026-09-13 (post-merge)

After PR #13 merged (91977bb) + post-merge CI fixes (44168b4 OPA in publish
job, 91cb525 job-scoped NODE_AUTH_TOKEN), the merged 0.7.0 was installed into
the prod stage `~/.pi/agent/npm/node_modules/pi-opa-net` (0.6.0 kept at
`.pi-opa-net-0.6.0.bak`).

CLI probes from the prod package (`prod-probes-cli.json`) — all `policy_path`
under `~/.pi/agent/...` (PROD-local), all `pi_opa_net_version: 0.7.0`:

| command | decision | rule |
|---|---|---|
| git stash pop | deny | block-git-stash-mutations |
| du -sh /var | deny | block-shallow-heavy-scan |
| sudo du -sh /var | deny | block-shallow-heavy-scan |
| find /home/bhd -name goal.json -mmin -15 | deny | block-home-wide-find |
| du -d 1 / | deny | block-shallow-heavy-scan |
| eza -T -L 99 / | deny | block-shallow-heavy-scan |
| eza -T -L 2 . / find / -maxdepth 1 / rg --max-depth 2 foo /var / git status | allow | — |

npm registry publish is BLOCKED by an external credential permission: the repo
`NPM_TOKEN` secret is an automation token WITHOUT publish rights to
`pi-opa-net` (owned by `buihongduc132`); CI publish job now correctly reaches
`PUT registry.npmjs.org/pi-opa-net` but npm returns `E404 Not Found`. The
deploy-to-machine steps (dev + prod) are satisfied via local tarball install;
npm publish needs a token with `pi-opa-net` publish scope.
