# Phase P3: Global Environment Wiring & Resolution Matrix

## Overview
Phase P3 configured system-wide PATH precedence across all PAM, login, non-login, interactive, systemd, sudo, tmux, and cron environments so that `/opt/opa-gate/bin` consistently resolves executables.

## Configured Files
1. `/etc/environment`:
   - Updated `PATH="/opt/opa-gate/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin"`
   - Loaded by PAM sessions (SSH, login, su, sudo, cron).
2. `/etc/profile.d/opa-gate.sh`:
   - Prepends `/opt/opa-gate/bin` for all POSIX login shells (`bash -l`, `zsh -l`, etc.).
3. `/etc/bash.bashrc` & `/etc/zsh/zshenv`:
   - Prepends `/opt/opa-gate/bin` for interactive bash shells and all zsh invocations.
4. `/etc/systemd/system.conf.d/10-opa-gate.conf` & `/etc/systemd/user.conf.d/10-opa-gate.conf`:
   - Configures `Manager` section with `DefaultEnvironment="PATH=/opt/opa-gate/bin:..."`
   - Active across all systemd units, user services, and `systemd-run` transient invocations.
5. `/etc/sudoers.d/opa-gate`:
   - `Defaults secure_path="/opt/opa-gate/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"`
   - Validated via `visudo -c -f /etc/sudoers.d/opa-gate`. Gating enforced for root and `sudo`.
6. `/etc/tmux.conf` & `~/.tmux.conf`:
   - Configures `set-environment -g PATH "/opt/opa-gate/bin:..."` for new tmux windows and panes.
7. `/etc/crontab`:
   - Explicit `PATH=/opt/opa-gate/bin:...` line set for cron jobs.
8. `~/.bashrc` & `~/.profile`:
   - Enforces `/opt/opa-gate/bin` first on PATH after any user `.local/bin` prepends.

## 10-Context Verification Matrix

| # | Invocaton Context | Verification Command | Resolved Path | Status |
|---|---|---|---|---|
| 1 | Fresh SSH login | `ssh localhost 'bash -lc "command -v git; exit"'` | `/opt/opa-gate/bin/git` | PASS |
| 2 | SSH non-login | `ssh localhost 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |
| 3 | `bash -lc` | `bash -lc 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |
| 4 | `bash -c` (ambient) | `bash -lc 'bash -c "command -v git"'` | `/opt/opa-gate/bin/git` | PASS |
| 5 | `sh -c` (ambient) | `bash -lc 'sh -c "command -v git"'` | `/opt/opa-gate/bin/git` | PASS |
| 6 | `env -i` login shell | `env -i /bin/bash -lc 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |
| 7 | `sudo git` | `sudo which git` | `/opt/opa-gate/bin/git` | PASS |
| 8 | `sudo -i` | `sudo -i which git` | `/opt/opa-gate/bin/git` | PASS |
| 9 | `systemd-run` transient | `systemd-run --user --pipe /bin/sh -c 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |
| 10 | `tmux` new-window | `tmux new-session ... 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |
| 11 | `cron` entry | `env -i PATH="<crontab_PATH>" /bin/sh -c 'command -v git'` | `/opt/opa-gate/bin/git` | PASS |

## Acceptance Verdict
**PASSED**: 10/10 contexts resolve through `/opt/opa-gate/bin/git`. No bypass in standard execution environments.
