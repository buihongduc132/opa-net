# LSL: `sudo`/`env`/`timeout` prefixes bypassed every program_base rule

## Context
Turn-1 incident was `sudo -n du -xh -d1 /` hanging 300s on a 99%-full root. GROUP L denied `du -sh /var` but `sudo du -sh /var` → ALLOW (`program=sudo`). Same for `env FOO=1 du`, `timeout 30 find /`, `nohup du`. Every `program_base`-keyed rule (GROUP K/L and others) was defeated by a wrapper prefix. Gotcha `wrapper-unwrap` was on the plan as pending.

## Solutions
Parser-level `src/parser/unwrapWrapperProgram.ts` wired into `ShellQuoteParser.classify`: strip `sudo`/`env`/`nice`/`nohup`/`time`/`timeout`/`stdbuf`/`ionice` (value flags, `env VAR=`, timeout duration) before program classification. `input.raw` keeps the full original for raw-token rules. 14 unit tests + e2e fixture cases (`sudo-du-var`, `env-du-root`, `timeout-find-root`).

## Gotchas
- Value-taking vs boolean flags: `timeout --preserve-status` and `ionice -t` are BOOLEAN — listing them as value-taking ate the real program (`du`) as the "value" and re-opened the bypass (cubic P1). `env -C DIR` IS value-taking — missing it made `DIR` the program.
- Stacked wrappers (`nohup time sudo du`) must unwrap in a loop until the real program.
- Wrapper-alone (`sudo -n`, `env FOO=1`) must keep original tokens — unwrapping would consume everything.

## Ref
src/parser/unwrapWrapperProgram.ts
tests/unit/parser/unwrapWrapperProgram.test.ts
flow/plans/ban-shallow-heavy-scan.md (wrapper-unwrap, OT7)
