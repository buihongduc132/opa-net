# Phase P6: Health Monitor, Deny-Storm Watchdog, and Log Caps

## Overview
Phase P6 establishes continuous automated health monitoring, anomaly detection, and storage bounds across the Universal Shell Gate architecture:
1. **Health Timer (5m)**: Smoke-tests safety evaluation every 5 minutes; fires high-priority alerts to Slack #opa-net if the engine becomes unreachable or malformed.
2. **Watchdog Anomaly Scanning**: Extends the S8 reflog watchdog to monitor `/var/log/opa-gate/audit.jsonl` and running process trees for deny-storms and absolute-path bypass attempts.
3. **Log Capping**: Enforces strict storage bounds (`max-size=10m`, `max-file=3`) via both inline Python rotation and `/etc/logrotate.d/opa-gate`.

---

## 1. Engine Health Monitor (`opa-gate-health`)

### Implementation
- **Script**: `scripts/opa-gate-health` (installed to `/opt/opa-gate/scripts/opa-gate-health`).
- **Service**: `/etc/systemd/system/opa-gate-health.service` (oneshot, idle scheduling, run as user `bhd`).
- **Timer**: `/etc/systemd/system/opa-gate-health.timer` (runs every 5m: `OnBootSec=1m`, `OnUnitActiveSec=5m`).
- **Smoke Probe**: Executes `pi-opa-net eval "git stash pop" --json` with a 10s timeout.
  - Expected: Returncode 2, JSON payload containing `"decision": "deny"` and rule `"block-git-stash-mutations"`.
- **Status Persistence**: Writes `{ "status": "healthy", "duration_ms": 179, "last_check": ... }` to `/var/log/opa-gate/health.status`.

### Failure Mode & Alarm Round-Trip
- Tested via simulated engine error (`OPA_GATE_ENGINE_BIN=/bin/false`):
  - Returncode: `1`
  - Output logged to `/var/log/opa-gate/audit.jsonl`: `{"schema_version": "1.0", "decision": "health_failure", "error": "Unexpected returncode 1..."}`
  - Emitted to syslog: `logger -p user.err -t opa-gate-health "Engine check FAILED..."`
  - Delivered Slack alert to `#opa-net` (`C0C42KW561E`) via `slackcli`.
  - `/var/log/opa-gate/health.status` marked `"status": "unhealthy"`.
- Restored to healthy immediately on subsequent normal execution.

---

## 2. Deny-Storm & Residual Watchdog Extension

### Implementation
- **Script**: `scripts/branch_drift_watchdog.py` (deployed to `/home/bhd/Documents/Projects/bhd/opa-net/scripts/branch_drift_watchdog.py`).
- **Service**: `opa-net-branch-drift-watchdog.service` + `opa-net-branch-drift-watchdog.timer` (user unit, every 2 minutes).

### Anomaly Detectors Added:
1. **Deny-Storm Detection**:
   - Scans `/var/log/opa-gate/audit.jsonl` incrementally via tracked byte offset.
   - Detects when $\ge 5$ denials occur within any 60-second window.
   - Verified against test fixture `tests/fixtures/fake-deny-storm.jsonl`: detected 6 denials in 12s window, reported rules, target directory, and sample commands.
   - Sends Slack alert: `🚨 [opa-gate watchdog] Deny-storm detected! (Repeated gate denials)`.
2. **Absolute-Path Git Residual Detection**:
   - Analyzes raw command strings in `audit.jsonl` matching direct binary invocations (`/usr/bin/git`, `/bin/git`, `/usr/local/bin/git`).
   - Scans active process table (`ps -eo pid,user,args`) for processes running un-shimmed git executables.
   - Sends Slack alert: `⚠️ [opa-gate watchdog] Absolute-path git invocation residual detected!`.

---

## 3. Log Caps & Rotation (`max-size=10m max-file=3`)

### Implementation
1. **Inline Log Cap**: `scripts/opa_gate_log_cap.py` (deployed to `/opt/opa-gate/scripts/opa_gate_log_cap.py`).
   - Automatically executed by both `opa-gate-health` and `branch_drift_watchdog.py`.
   - Triggers copytruncate rotation when `/var/log/opa-gate/audit.jsonl` $\ge 10\text{ MB}$.
   - Maintains up to 3 gzip-compressed archives (`audit.jsonl.1.gz`, `audit.jsonl.2.gz`, `audit.jsonl.3.gz`).
2. **System Logrotate**: `/etc/logrotate.d/opa-gate`:
   ```
   /var/log/opa-gate/audit.jsonl /var/log/opa-gate/*.log {
       su root root
       rotate 3
       size 10M
       missingok
       notifempty
       compress
       copytruncate
   }
   ```

### Verification
- Tested on existing 11.8MB audit log: successfully rotated to `audit.jsonl.1.gz` (614KB compressed) and truncated active log to 0 bytes.
- Tested `sudo logrotate -d /etc/logrotate.d/opa-gate`: exit 0.

---

## 4. Boot Safety & Service Verification
- `systemd-analyze verify /etc/systemd/system/opa-gate-health.service /etc/systemd/system/opa-gate-health.timer`: exit 0.
- `systemd-analyze critical-chain`: zero gate units present in critical boot chain.
- `sudo systemctl status opa-gate-health.timer`: active (waiting), triggers every 5m.
- `systemctl --user status opa-net-branch-drift-watchdog.timer`: active (waiting), triggers every 2m.
