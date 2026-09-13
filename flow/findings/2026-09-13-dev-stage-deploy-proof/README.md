# Dev-stage deploy proof — pi-opa-net 0.7.0 in ~/.pi-dev-pi-plugins

> 2026-09-13 · goal mtz9obos-8w1qds · branch test/bhd-195-red-home-wide-find-grep
> Round-2 proof (after verifier round-1 fixes: eza N≤2 cap, OT7 depth-cap split, wrapper unwrap, fsck/baobab).

## Setup

- Package: local tarball `pi-opa-net-0.7.0.tgz` (post-round-1-fixes) installed into
  `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net`. Earlier copies kept as
  `.pi-opa-net-0.6.0.bak` / `.pi-opa-net-0.7.0-pre.bak`. Dev-stage
  `settings.json` package entry `npm:pi-opa-net` unchanged (config source of
  truth = profile/).
- Scratch repo: `/tmp/piopanet-dev-proof` (git init, 1 commit).
- Invocation: `PI_CODING_AGENT_DIR=/home/bhd/.pi-dev-pi-plugins pi -p "<10-cmd smoke>" --model zai/glm-5-turbo`
- Session transcript (final RESULT message): `~/.pi-dev-pi-plugins/sessions/--tmp-piopanet-dev-proof--/2026-09-13T04-54-37-819Z_01a0991e-09fb-71ee-8d88-32f0a10a9cf7.jsonl`

## Result (agent self-report — extracted verbatim from FINAL assistant message)

```
RESULT|1|git stash pop|BLOCKED
RESULT|2|du -sh /var|BLOCKED
RESULT|3|find /home/bhd -name goal.json -mmin -15|BLOCKED
RESULT|4|eza -T -L 2 .|ALLOWED
RESULT|5|git status --porcelain=v1|ALLOWED
RESULT|6|sudo du -sh /var|BLOCKED
RESULT|7|du -d 1 /|BLOCKED
RESULT|8|find / -maxdepth 1|ALLOWED
RESULT|9|rg --max-depth 2 foo /var|ALLOWED
RESULT|10|eza -T -L 99 /|BLOCKED
```

All 10 expected behaviors correct, including the round-1-fixed ones:
- `sudo du -sh /var` BLOCKED — wrapper unwrap closes the sudo-prefix bypass
  (turn-1 incident shape `sudo -n du -xh -d1 /`).
- `du -d 1 /` BLOCKED — OT7: du `-d` does not prune traversal, no exemption.
- `find / -maxdepth 1` + `rg --max-depth 2 foo /var` ALLOWED — OT7:
  descent-pruning caps ≤2 exempt.
- `eza -T -L 99 /` BLOCKED — eza level gate requires N ≤ 2.

## Audit decision records (authoritative, machine-written)

`<cwd>/.pi-opa-net/audit/<decisionId>.jsonl` — copies in this dir (9 records;
duplicates from the earlier 5-cmd run share commands):

| command | decision | rule_ids | pi_opa_net_version |
|---|---|---|---|
| `git stash pop` | deny | `block-git-stash-mutations` | 0.7.0 |
| `du -sh /var` | deny | `block-shallow-heavy-scan` (GROUP L) | 0.7.0 |
| `find /home/bhd -name goal.json -mmin -15` | deny | `block-home-wide-find` (GROUP K) | 0.7.0 |
| `sudo du -sh /var` | deny | `block-shallow-heavy-scan` | 0.7.0 |
| `du -d 1 /` | deny | `block-shallow-heavy-scan` | 0.7.0 |
| `eza -T -L 99 /` | deny | `block-shallow-heavy-scan` | 0.7.0 |

- `source: "opa"` in every deny (not fail-open).
- Allow-side probes (`eza -T -L 2 .`, `git status --porcelain=v1`,
  `find / -maxdepth 1`, `rg --max-depth 2 foo /var`) in `allow-probes-cli.json` —
  all `allow`, `pi_opa_net_version: 0.7.0`, `policy_path` under
  `~/.pi-dev-pi-plugins/npm/node_modules/pi-opa-net/policy/safety.rego`
  (DEV-STAGE-local). Allow decisions produce no audit JSONL by design
  (audit fires on deny + log_only); the transcript + CLI JSON are the allow
  evidence.

## Files

- `*.jsonl` (9) — machine-written deny decision records
- `session-result-lines.txt` — 10 RESULT lines extracted from the FINAL
  assistant message of the session transcript (prompt echo excluded)
- `allow-probes-cli.json` — 4 allow-side CLI decision records from the
  dev-stage package
