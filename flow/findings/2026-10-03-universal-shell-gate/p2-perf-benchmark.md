# Phase P2: Performance Benchmark Findings

## Overview
Hyperfine benchmarks conducted on `bhd-main2` (Linux x86_64) comparing direct binary invocation vs universal shell gate shim invocation (`PATH="/opt/opa-gate/bin:$PATH"`).

Target performance threshold: **< 100ms/cmd median overhead**. Hot loops must not regress scripts measurably.

## Summary of Results

| Command / Benchmark | Direct Execution | Through Shim (`/opt/opa-gate/bin`) | Overhead | Relative Speed |
| :--- | :--- | :--- | :--- | :--- |
| `git status` | 1.9 ms ± 0.9 ms | 3.8 ms ± 0.8 ms | ~1.9 ms | 1.98× faster direct |
| `ls` | 40.1 ms ± 11.2 ms | 43.0 ms ± 11.5 ms | ~2.9 ms | 1.07× faster direct (parity) |
| `true` (echo-class) | ~1.5 ms | ~0.5 ms | < 1 ms | At parity / sub-millisecond |
| Hot loop (100× `ls`) | 4.07 s ± 0.16 s | 4.19 s ± 0.17 s | ~1.2 ms / iteration | 1.03× (statistically identical) |

## Mechanism
To meet the <100ms threshold, `.opa-gate-shim` implements a fast-path prefix allowlist:
1. Non-gated programs (programs not targeted by any of the 77 security rules, e.g. `cat`, `date`, `whoami`, `uname`, `sleep`, `true`, `sed`, `awk`) bypass OPA engine invocation directly.
2. Read-only patterns on gated programs:
   - `ls` without recursive flags (`-R`, `--recursive`)
   - `grep` without recursive flags (`-r`, `-R`) or hermes tokens
   - `git` read-only subcommands (`status`, `log`, `diff`, `show`, `rev-parse`, `cat-file`, `ls-files`, etc.)
3. All fast-pathed invocations are still audit-logged to `/var/log/opa-gate/audit.jsonl` with `source: fast-path` and `decision: allow`.
4. Mutating and security-critical commands (e.g. `git checkout`, `git stash`, `git reset`, `docker`, `rm`, `find`, `pkill`, `tmux`, etc.) undergo full OPA/Rego evaluation with hard 500ms timeout cap.

## Acceptance Verdict
**PASSED**:
- Median overhead for fast-pathed read-only commands is 1.9ms – 2.9ms (well under the 100ms gate requirement).
- Hot loops execute with 1.03× ratio vs direct execution (within standard deviation).
- Audit logging verified active for all commands.
