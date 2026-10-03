#!/usr/bin/env python3
"""
Branch Drift Watchdog (S8) — opa-net
====================================
Monitors protected git directories (main repos + worktrees younger than PIOPANET_PROTECT_DAYS=3)
for unauthorized branch drift off the allowlist:
  {dev, main, staging, test, stag, master}

Metal-ops wiring rules:
- systemd-analyze verify exit 0
- NOT boot-critical (idle-priority, oneshot)
- Atomic state file persistence
- Zero false positives on 7-day retro scan
- Local log only (Slack posting disabled) — appends flow/findings/.../watchdog.log
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

DEFAULT_SCAN_ROOTS = ["/home/bhd/Documents/Projects"]
DEFAULT_ALLOWLIST = {"dev", "main", "staging", "test", "stag", "master"}
DEFAULT_PROTECT_DAYS = 3.0
DEFAULT_SLACK_CHANNEL = ""  # Disabled — local log only
DEFAULT_STATE_FILE = os.path.expanduser("~/.local/state/opa-net/watchdog-state.json")

REFLOG_LINE_RE = re.compile(
    r"^(?P<old_sha>[0-9a-f]{40})\s+(?P<new_sha>[0-9a-f]{40})\s+(?P<committer>.*?)\s+(?P<ts>\d{9,12})\s+(?P<tz>[+-]\d{4})(?:\t(?P<msg>.*))?$"
)
CHECKOUT_RE = re.compile(r"checkout:\s+moving\s+from\s+(\S+)\s+to\s+(\S+)")
RENAME_RE = re.compile(r"Branch:\s+renamed\s+(?:refs/heads/)?(\S+)\s+to\s+(?:refs/heads/)?(\S+)")


class ProtectedTarget:
    def __init__(
        self,
        kind: str,
        repo_name: str,
        target_path: str,
        reflog_path: str,
        age_days: float,
        creation_ts: Optional[int] = None,
    ):
        self.kind = kind  # 'MAIN', 'YOUNG_WORKTREE', 'YOUNG_CLONE'
        self.repo_name = repo_name
        self.target_path = target_path
        self.reflog_path = reflog_path
        self.age_days = age_days
        self.creation_ts = creation_ts

    def __repr__(self) -> str:
        return f"<ProtectedTarget {self.kind} {self.target_path} (age={self.age_days:.1f}d)>"


class DriftEvent:
    def __init__(
        self,
        target: ProtectedTarget,
        ts: int,
        action_type: str,
        from_ref: str,
        to_ref: str,
        raw_msg: str,
    ):
        self.target = target
        self.ts = ts
        self.action_type = action_type
        self.from_ref = from_ref
        self.to_ref = to_ref
        self.raw_msg = raw_msg

    def iso_time(self) -> str:
        return datetime.datetime.fromtimestamp(self.ts, datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )

    def human_str(self) -> str:
        return (
            f"[{self.iso_time()}] {self.target.kind} {self.target.target_path} "
            f"({self.target.repo_name}): {self.from_ref} -> {self.to_ref} "
            f'| action: "{self.raw_msg}"'
        )


def clean_ref_name(ref: str) -> str:
    """Normalize branch ref (strip refs/heads/)."""
    if ref.startswith("refs/heads/"):
        return ref[len("refs/heads/") :]
    return ref


def parse_reflog_line(line: str) -> Optional[Tuple[str, str, int, str]]:
    """Parse one git reflog line -> (old_sha, new_sha, ts, msg)."""
    m = REFLOG_LINE_RE.match(line.strip())
    if not m:
        return None
    try:
        ts = int(m.group("ts"))
    except ValueError:
        return None
    msg = m.group("msg") or ""
    return m.group("old_sha"), m.group("new_sha"), ts, msg


def get_reflog_first_entry(reflog_path: str) -> Optional[Tuple[int, str]]:
    """Get creation timestamp and initial commit sha from first line of reflog."""
    if not os.path.exists(reflog_path):
        return None
    try:
        with open(reflog_path, "r", encoding="utf-8", errors="replace") as fp:
            for line in fp:
                res = parse_reflog_line(line)
                if res:
                    return res[2], res[1]  # ts, new_sha
    except Exception:
        pass
    return None


def detect_branch_drift(raw_msg: str, allowlist: Set[str]) -> Optional[Tuple[str, str, str]]:
    """
    Check if raw_msg represents a branch move off allowlist.
    Returns (action_type, from_ref, to_ref) if violation, else None.
    """
    m_co = CHECKOUT_RE.search(raw_msg)
    if m_co:
        from_b = clean_ref_name(m_co.group(1))
        to_b = clean_ref_name(m_co.group(2))
        # Condition for drift: destination branch changed AND destination is NOT in allowlist
        if to_b != from_b and to_b not in allowlist:
            return "checkout", from_b, to_b
        return None

    m_ren = RENAME_RE.search(raw_msg)
    if m_ren:
        from_b = clean_ref_name(m_ren.group(1))
        to_b = clean_ref_name(m_ren.group(2))
        if to_b not in allowlist:
            return "rename", from_b, to_b
        return None

    return None


def find_repositories(scan_roots: List[str]) -> List[str]:
    """Fast discovery of git repositories across scan roots, supporting symlinks."""
    prune = {
        ".git",
        "node_modules",
        "dist",
        "build",
        ".cache",
        "target",
        ".next",
        ".venv",
        "venv",
        ".turbo",
    }
    repos: List[str] = []

    def scan_dir(path: str, depth: int = 0, max_depth: int = 3) -> None:
        if depth > max_depth or not os.path.isdir(path):
            return
        try:
            entries = sorted(os.listdir(path))
        except Exception:
            return
        for e in entries:
            if e in prune or e.startswith("."):
                continue
            full = os.path.join(path, e)
            git_path = os.path.join(full, ".git")
            if os.path.exists(git_path):
                repos.append(full)
                comp = os.path.join(full, "components")
                if os.path.isdir(comp):
                    scan_dir(comp, depth + 1, max_depth)
            elif os.path.isdir(full):
                scan_dir(full, depth + 1, max_depth)

    for root_dir in scan_roots:
        if os.path.exists(os.path.join(root_dir, ".git")):
            repos.append(root_dir)
        else:
            scan_dir(root_dir, depth=0, max_depth=3)

    return sorted(list(set(repos)))


def discover_protected_targets(
    scan_roots: List[str], protect_days: float, now_ts: float
) -> List[ProtectedTarget]:
    """
    Discover all protected directories per Plan S2 / user spec:
    1. MAIN dirs (parent repos where .git is directory and shortest sibling basename).
    2. Linked worktrees registered in <repo>/.git/worktrees/* younger than protect_days.
    3. Standalone clone lanes younger than protect_days.
    """
    repos = find_repositories(scan_roots)
    protect_secs = protect_days * 86400.0
    targets: List[ProtectedTarget] = []
    seen_reflogs: Set[str] = set()

    # Group repos by parent directory for sibling-clone detection
    by_parent: Dict[str, List[str]] = {}
    for r in repos:
        p = os.path.dirname(r)
        by_parent.setdefault(p, []).append(r)

    for parent_dir, sib_repos in by_parent.items():
        basenames = [os.path.basename(r) for r in sib_repos]

        for repo_path in sib_repos:
            bname = os.path.basename(repo_path)
            git_path = os.path.join(repo_path, ".git")

            if os.path.isfile(git_path):
                # Linked worktree encountered directly - handled via parent repo's .git/worktrees
                continue

            # Determine if this repo is a main repo or a sibling clone lane
            is_main = True
            for other_bname in basenames:
                if other_bname != bname:
                    if (
                        bname.startswith(other_bname + "-")
                        or bname.startswith(other_bname + ".")
                    ) and len(other_bname) < len(bname):
                        is_main = False
                        break

            repo_head_reflog = os.path.join(git_path, "logs", "HEAD")
            real_reflog = os.path.realpath(repo_head_reflog) if os.path.exists(repo_head_reflog) else None

            if is_main:
                if real_reflog and real_reflog not in seen_reflogs:
                    seen_reflogs.add(real_reflog)
                    first_info = get_reflog_first_entry(repo_head_reflog)
                    first_ts = first_info[0] if first_info else None
                    targets.append(
                        ProtectedTarget(
                            kind="MAIN",
                            repo_name=bname,
                            target_path=repo_path,
                            reflog_path=repo_head_reflog,
                            age_days=0.0,
                            creation_ts=first_ts,
                        )
                    )
            else:
                # Standalone clone lane: protected only if younger than protect_days
                if real_reflog and real_reflog not in seen_reflogs:
                    first_info = get_reflog_first_entry(repo_head_reflog)
                    if first_info:
                        age_secs = max(0.0, now_ts - first_info[0])
                        first_ts = first_info[0]
                    else:
                        age_secs = max(0.0, now_ts - os.stat(repo_path).st_mtime)
                        first_ts = None

                    age_days = age_secs / 86400.0
                    if age_days < protect_days:
                        seen_reflogs.add(real_reflog)
                        targets.append(
                            ProtectedTarget(
                                kind="YOUNG_CLONE",
                                repo_name=bname,
                                target_path=repo_path,
                                reflog_path=repo_head_reflog,
                                age_days=age_days,
                                creation_ts=first_ts,
                            )
                        )

            # Inspect linked worktrees registered in <repo>/.git/worktrees
            wt_base = os.path.join(git_path, "worktrees")
            if os.path.isdir(wt_base):
                for wt_id in os.listdir(wt_base):
                    wt_meta = os.path.join(wt_base, wt_id)
                    if not os.path.isdir(wt_meta):
                        continue
                    wt_reflog = os.path.join(wt_meta, "logs", "HEAD")
                    real_wt_reflog = os.path.realpath(wt_reflog) if os.path.exists(wt_reflog) else None
                    if not real_wt_reflog or real_wt_reflog in seen_reflogs:
                        continue

                    wt_gitdir_file = os.path.join(wt_meta, "gitdir")
                    wt_actual_dir = repo_path
                    if os.path.exists(wt_gitdir_file):
                        try:
                            with open(wt_gitdir_file, "r", encoding="utf-8") as gfp:
                                content = gfp.read().strip()
                            if content.endswith("/.git"):
                                wt_actual_dir = content[:-5]
                            else:
                                wt_actual_dir = os.path.dirname(content)
                        except Exception:
                            pass

                    first_info = get_reflog_first_entry(wt_reflog)
                    if first_info:
                        age_secs = max(0.0, now_ts - first_info[0])
                        first_ts = first_info[0]
                    else:
                        try:
                            age_secs = max(0.0, now_ts - os.stat(wt_actual_dir).st_mtime)
                        except Exception:
                            age_secs = float("inf")
                        first_ts = None

                    age_days = age_secs / 86400.0
                    if age_days < protect_days:
                        seen_reflogs.add(real_wt_reflog)
                        targets.append(
                            ProtectedTarget(
                                kind="YOUNG_WORKTREE",
                                repo_name=f"{bname} [{wt_id}]",
                                target_path=wt_actual_dir,
                                reflog_path=wt_reflog,
                                age_days=age_days,
                                creation_ts=first_ts,
                            )
                        )

    return targets


def load_state(state_file: str) -> Dict:
    """Load incremental state file."""
    if not os.path.exists(state_file):
        return {"version": 1, "last_scan_ts": 0, "files": {}}
    try:
        with open(state_file, "r", encoding="utf-8") as fp:
            data = json.load(fp)
            if not isinstance(data, dict):
                return {"version": 1, "last_scan_ts": 0, "files": {}}
            data.setdefault("files", {})
            return data
    except Exception as e:
        sys.stderr.write(f"Warning: could not parse state file {state_file}: {e}\n")
        return {"version": 1, "last_scan_ts": 0, "files": {}}


def save_state(state_file: str, state_data: Dict) -> None:
    """Save state atomically using atomic swap (.tmp.<pid> -> replace)."""
    p = Path(state_file)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = f"{state_file}.tmp.{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as fp:
        json.dump(state_data, fp, indent=2)
        fp.flush()
        os.fsync(fp.fileno())
    os.replace(tmp_path, state_file)


def scan_incremental(
    targets: List[ProtectedTarget],
    state: Dict,
    allowlist: Set[str],
    now_ts: float,
    retro_days: Optional[float] = None,
) -> Tuple[List[DriftEvent], Dict]:
    """
    Scan reflogs. If retro_days is set, scans entries within retro_days window.
    Otherwise scans incrementally using state offsets/timestamps.
    """
    events: List[DriftEvent] = []
    files_state = state.get("files", {})
    last_scan_ts = state.get("last_scan_ts", 0)

    if retro_days is not None:
        min_ts = now_ts - (retro_days * 86400.0)
    else:
        min_ts = last_scan_ts

    new_files_state = dict(files_state)

    for target in targets:
        rf = target.reflog_path
        if not os.path.exists(rf):
            continue

        try:
            rf_stat = os.stat(rf)
            rf_size = rf_stat.st_size
            rf_mtime = rf_stat.st_mtime
        except Exception:
            continue

        file_meta = files_state.get(rf, {})
        last_offset = file_meta.get("offset", 0)

        # In retro mode: always read from beginning
        if retro_days is not None:
            read_offset = 0
        else:
            # If file shrank or rotated: reset offset
            if rf_size < last_offset:
                read_offset = 0
            else:
                read_offset = last_offset

        try:
            with open(rf, "r", encoding="utf-8", errors="replace") as fp:
                if read_offset > 0:
                    fp.seek(read_offset)

                while True:
                    cur_pos = fp.tell()
                    line = fp.readline()
                    if not line:
                        break
                    res = parse_reflog_line(line)
                    if not res:
                        continue
                    old_sha, new_sha, ts, msg = res

                    # Only evaluate entries strictly newer than min_ts (unless retro)
                    if ts >= min_ts:
                        drift = detect_branch_drift(msg, allowlist)
                        if drift:
                            action_type, from_b, to_b = drift
                            events.append(
                                DriftEvent(
                                    target=target,
                                    ts=ts,
                                    action_type=action_type,
                                    from_ref=from_b,
                                    to_ref=to_b,
                                    raw_msg=msg,
                                )
                            )

                end_pos = fp.tell()

            # Record updated position for incremental run
            if retro_days is None:
                new_files_state[rf] = {
                    "offset": end_pos,
                    "mtime": rf_mtime,
                    "size": rf_size,
                    "target": target.target_path,
                    "kind": target.kind,
                }
        except Exception as e:
            sys.stderr.write(f"Error scanning {rf}: {e}\n")

    updated_state = dict(state)
    if retro_days is None:
        updated_state["last_scan_ts"] = int(now_ts)
        updated_state["files"] = new_files_state

    # Sort events chronologically
    events.sort(key=lambda ev: ev.ts)
    return events, updated_state


def send_slack_message(
    msg_text: str,
    channel_id: Optional[str] = None,
    thread_ts: Optional[str] = None,
) -> Optional[str]:
    """Slack alerts disabled per user policy — local log only. Always returns None."""
    return None


def send_slack_alert(
    event: DriftEvent,
    channel_id: Optional[str] = None,
    thread_ts: Optional[str] = None,
) -> Optional[str]:
    """Slack alerts disabled per user policy — local log only. Always returns None."""
    return None


def append_watchdog_log(log_path: str, event: DriftEvent, slack_ts: Optional[str] = None) -> None:
    """Append alert record to watchdog.log."""
    p = Path(log_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ts_str = event.iso_time()
    slack_info = f", slack_ts={slack_ts}" if slack_ts else ""
    line = (
        f"[{ts_str}] ALERT: Branch drift detected in {event.target.kind} "
        f"{event.target.target_path}: {event.from_ref} -> {event.to_ref} "
        f'(reflog: "{event.raw_msg}", ts: {event.ts}{slack_info})\n'
    )
    with open(log_path, "a", encoding="utf-8") as fp:
        fp.write(line)
        fp.flush()


def append_custom_watchdog_log(log_path: str, msg: str, slack_ts: Optional[str] = None) -> None:
    """Append custom alert record to watchdog.log."""
    p = Path(log_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ts_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    slack_info = f", slack_ts={slack_ts}" if slack_ts else ""
    line = f"[{ts_str}] ALERT: {msg}{slack_info}\n"
    with open(log_path, "a", encoding="utf-8") as fp:
        fp.write(line)
        fp.flush()


def parse_iso_ts(iso_str: str) -> float:
    try:
        dt = datetime.datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return time.time()


def scan_audit_log_for_storms_and_residuals(
    audit_log_path: str,
    state: dict,
    channel_id: str,
    thread_ts: Optional[str],
    dry_run: bool,
    log_path: str,
) -> Tuple[List[dict], List[dict], dict]:
    """
    Scan /var/log/opa-gate/audit.jsonl incrementally:
    1. Deny-storms: >=5 denys in 60s from same PID/agent or caller.
    2. Absolute-path git invocations (e.g. /usr/bin/git).
    """
    storm_alerts = []
    residual_alerts = []
    updated_state = dict(state)

    if not os.path.exists(audit_log_path):
        return storm_alerts, residual_alerts, updated_state

    current_size = os.path.getsize(audit_log_path)
    last_offset = state.get("audit_offset", 0)
    if last_offset > current_size:
        last_offset = 0

    new_denials = []
    new_residuals = []

    try:
        with open(audit_log_path, "r", encoding="utf-8", errors="replace") as fp:
            fp.seek(last_offset)
            for line in fp:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    rec = json.loads(line_str)
                except Exception:
                    continue

                ts = parse_iso_ts(rec.get("evaluated_at", ""))
                decision = rec.get("decision", "")
                raw_cmd = rec.get("input", {}).get("raw", "")
                reasons = rec.get("reasons") or [{}]
                rule_id = reasons[0].get("rule_id", "unknown") if reasons else "unknown"
                cwd = rec.get("signals", {}).get("env", {}).get("cwd", "")

                if decision == "deny":
                    new_denials.append({
                        "ts": ts,
                        "rule": rule_id,
                        "cwd": cwd,
                        "raw": raw_cmd,
                    })

                # Check for absolute-path git residuals in raw command or program
                if re.search(r"(?:^|[\s;`|&])(/usr/bin/git|/bin/git|/usr/local/bin/git)\b", raw_cmd):
                    new_residuals.append({
                        "ts": ts,
                        "command": raw_cmd,
                        "cwd": cwd,
                    })

            new_offset = fp.tell()
            updated_state["audit_offset"] = new_offset
    except PermissionError:
        return storm_alerts, residual_alerts, updated_state
    except Exception as e:
        sys.stderr.write(f"Error reading audit log {audit_log_path}: {e}\n")
        return storm_alerts, residual_alerts, updated_state

    # Detect Deny-storms (>=5 denys in 60s)
    if len(new_denials) >= 5:
        new_denials.sort(key=lambda d: d["ts"])
        for i in range(len(new_denials)):
            window = [d for d in new_denials[i:] if d["ts"] - new_denials[i]["ts"] <= 60.0]
            if len(window) >= 5:
                sample_cmds = [w["raw"] for w in window[:3]]
                rules = list(set(w["rule"] for w in window))
                cwd = window[0]["cwd"]
                storm_event = {
                    "count": len(window),
                    "window_s": max(1, int(window[-1]["ts"] - window[0]["ts"])),
                    "cwd": cwd,
                    "rules": rules,
                    "samples": sample_cmds,
                    "ts": window[-1]["ts"],
                }
                storm_alerts.append(storm_event)
                break

    for res in new_residuals:
        residual_alerts.append(res)

    if not dry_run:
        for sa in storm_alerts:
            msg = (
                f"🚨 *[opa-gate watchdog]* Deny-storm detected! (Repeated gate denials)\n"
                f"• *Count*: {sa['count']} denials within {sa['window_s']}s window\n"
                f"• *Target CWD*: `{sa['cwd']}`\n"
                f"• *Violated Rules*: `{', '.join(sa['rules'])}`\n"
                f"• *Sample Commands*:\n" + "\n".join(f"  - `{c[:100]}`" for c in sa["samples"])
            )
            delivered_ts = send_slack_message(msg, channel_id, thread_ts)
            append_custom_watchdog_log(log_path, f"DENY_STORM: {sa['count']} denials in {sa['window_s']}s at {sa['cwd']}", delivered_ts)

        for ra in residual_alerts:
            msg = (
                f"⚠️ *[opa-gate watchdog]* Absolute-path git invocation residual detected!\n"
                f"• *Command*: `{ra['command'][:120]}`\n"
                f"• *Target CWD*: `{ra['cwd']}`\n"
                f"• *Bypass Mechanism*: Explicit path bypassed `/opt/opa-gate/bin` shim\n"
                f"• *Action*: Use standard `git` command or mint unlock key."
            )
            delivered_ts = send_slack_message(msg, channel_id, thread_ts)
            append_custom_watchdog_log(log_path, f"RESIDUAL_PATH: {ra['command']} at {ra['cwd']}", delivered_ts)

    return storm_alerts, residual_alerts, updated_state


def scan_running_processes_for_residuals(
    channel_id: str,
    thread_ts: Optional[str],
    dry_run: bool,
    log_path: str,
) -> List[dict]:
    """
    Check running processes (ps) for direct /usr/bin/git or /bin/git invocations in protected projects.
    """
    proc_alerts = []
    try:
        res = subprocess.run(["ps", "-eo", "pid,user,args"], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines()[1:]:
            parts = line.strip().split(None, 2)
            if len(parts) < 3:
                continue
            pid, user, args = parts[0], parts[1], parts[2]
            if "branch_drift_watchdog" in args or "run-p5-matrix" in args or "ps -eo" in args:
                continue
            if re.search(r"(?:^|[\s;`|&])(/usr/bin/git|/bin/git)\b", args):
                proc_alerts.append({"pid": pid, "user": user, "args": args})
                if not dry_run:
                    msg = (
                        f"⚠️ *[opa-gate watchdog]* Active residual process running direct git binary!\n"
                        f"• *PID*: `{pid}` (user: `{user}`)\n"
                        f"• *Command*: `{args[:120]}`\n"
                        f"• *Bypass*: Direct binary execution bypasses `/opt/opa-gate/bin`."
                    )
                    delivered_ts = send_slack_message(msg, channel_id, thread_ts)
                    append_custom_watchdog_log(log_path, f"ACTIVE_RESIDUAL_PROC: PID {pid} ({user}): {args}", delivered_ts)
    except Exception as e:
        sys.stderr.write(f"Error checking processes: {e}\n")
    return proc_alerts



def resolve_log_path(explicit_path: Optional[str]) -> str:
    """Determine watchdog.log path."""
    if explicit_path:
        return explicit_path
    if os.environ.get("PIOPANET_WATCHDOG_LOG_FILE"):
        return os.environ["PIOPANET_WATCHDOG_LOG_FILE"]
    # Check relative to script directory
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    findings_log = repo_root / "flow" / "findings" / "2026-10-03-branch-gate-not-firing" / "watchdog.log"
    return str(findings_log)


def main():
    parser = argparse.ArgumentParser(
        description="opa-net S8 branch drift reflog watchdog for protected directories."
    )
    parser.add_argument(
        "--scan-root",
        action="append",
        help="Scan root directory (can specify multiple or comma-separated). Default: /home/bhd/Documents/Projects",
    )
    parser.add_argument(
        "--state-file",
        default=os.environ.get("PIOPANET_WATCHDOG_STATE_FILE", DEFAULT_STATE_FILE),
        help=f"Path to incremental state file (default: {DEFAULT_STATE_FILE})",
    )
    parser.add_argument(
        "--log-file",
        help="Path to watchdog.log (default: flow/findings/2026-10-03-branch-gate-not-firing/watchdog.log)",
    )
    parser.add_argument(
        "--slack-channel",
        default=os.environ.get("PIOPANET_WATCHDOG_SLACK_CHANNEL", DEFAULT_SLACK_CHANNEL),
        help="Slack channel recipient ID (disabled, local log only)",
    )
    parser.add_argument(
        "--slack-thread-ts",
        help="Optional thread timestamp to reply into (for test runs in #__workflow)",
    )
    parser.add_argument(
        "--protect-days",
        type=float,
        default=float(os.environ.get("PIOPANET_PROTECT_DAYS", DEFAULT_PROTECT_DAYS)),
        help="Age threshold in days for young-worktree protection (default: 3.0)",
    )
    parser.add_argument(
        "--allowed-branches",
        default=os.environ.get(
            "PIOPANET_ALLOWED_BRANCHES", ",".join(sorted(DEFAULT_ALLOWLIST))
        ),
        help="Comma-separated allowlist of branch names",
    )
    parser.add_argument(
        "--retro",
        type=float,
        metavar="DAYS",
        help="Run historical scan over the past N days of reflogs (does not alert or update state)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan without alerting to Slack or writing state file",
    )
    parser.add_argument(
        "--init-state",
        action="store_true",
        help="Initialize state with current reflog EOF positions and exit",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single scan iteration and exit (for systemd timer execution)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit results as JSON to stdout",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose stdout output",
    )
    parser.add_argument(
        "--audit-log",
        default=os.environ.get("OPA_GATE_AUDIT_LOG", "/var/log/opa-gate/audit.jsonl"),
        help="Path to opa-gate audit log for deny-storm and residual monitoring",
    )
    parser.add_argument(
        "--no-audit-scan",
        action="store_true",
        help="Disable scanning audit log for deny-storms and residuals",
    )

    args = parser.parse_args()

    # Parse scan roots
    if args.scan_root:
        scan_roots = []
        for r in args.scan_root:
            scan_roots.extend([x.strip() for x in r.split(",") if x.strip()])
    elif os.environ.get("PIOPANET_SCAN_ROOTS"):
        scan_roots = [
            x.strip()
            for x in os.environ["PIOPANET_SCAN_ROOTS"].split(",")
            if x.strip()
        ]
    else:
        scan_roots = DEFAULT_SCAN_ROOTS

    allowlist = {b.strip() for b in args.allowed_branches.split(",") if b.strip()}
    now_ts = time.time()
    log_path = resolve_log_path(args.log_file)

    if args.verbose:
        sys.stderr.write(f"[watchdog] Scan roots: {scan_roots}\n")
        sys.stderr.write(f"[watchdog] Allowlist: {sorted(allowlist)}\n")
        sys.stderr.write(f"[watchdog] Protect days: {args.protect_days}\n")
        sys.stderr.write(f"[watchdog] State file: {args.state_file}\n")
        sys.stderr.write(f"[watchdog] Log file: {log_path}\n")

    targets = discover_protected_targets(scan_roots, args.protect_days, now_ts)
    if args.verbose:
        sys.stderr.write(f"[watchdog] Discovered {len(targets)} protected targets.\n")

    state = load_state(args.state_file)

    # Initialize state mode
    if args.init_state:
        # Record current EOF positions for all discovered targets
        files_state = {}
        for t in targets:
            if os.path.exists(t.reflog_path):
                try:
                    sz = os.path.getsize(t.reflog_path)
                    mt = os.stat(t.reflog_path).st_mtime
                    files_state[t.reflog_path] = {
                        "offset": sz,
                        "mtime": mt,
                        "size": sz,
                        "target": t.target_path,
                        "kind": t.kind,
                    }
                except Exception:
                    pass
        state["last_scan_ts"] = int(now_ts)
        state["files"] = files_state
        save_state(args.state_file, state)
        if args.json:
            print(json.dumps({"initialized": True, "target_count": len(files_state)}))
        else:
            print(f"Initialized state file {args.state_file} with {len(files_state)} targets.")
        return 0

    # Scan
    events, updated_state = scan_incremental(
        targets=targets,
        state=state,
        allowlist=allowlist,
        now_ts=now_ts,
        retro_days=args.retro,
    )

    # In retro mode: do not alert or update state, simply report
    if args.retro is not None:
        if args.json:
            report = {
                "mode": "retro",
                "days": args.retro,
                "targets_checked": len(targets),
                "violations_count": len(events),
                "events": [
                    {
                        "ts": ev.ts,
                        "iso_time": ev.iso_time(),
                        "target": ev.target.target_path,
                        "repo_name": ev.target.repo_name,
                        "kind": ev.target.kind,
                        "from": ev.from_ref,
                        "to": ev.to_ref,
                        "action": ev.raw_msg,
                    }
                    for ev in events
                ],
            }
            print(json.dumps(report, indent=2))
        else:
            print(f"=== Retro Scan ({args.retro} days) ===")
            print(f"Targets checked: {len(targets)}")
            print(f"Violations detected: {len(events)}")
            for ev in events:
                print(f"  {ev.human_str()}")
        return 0

    # Normal mode: handle detected drift events
    if events and not args.dry_run:
        for ev in events:
            # 1. Slack alert disabled (local log only)
            delivered_ts = send_slack_alert(
                event=ev,
                channel_id=args.slack_channel,
                thread_ts=args.slack_thread_ts,
            )
            # 2. Append to watchdog.log
            append_watchdog_log(log_path, ev, delivered_ts)

    # Scan audit log for deny-storms and absolute-path residuals
    storm_events = []
    residual_events = []
    proc_residuals = []
    if not args.no_audit_scan and args.retro is None:
        storm_events, residual_events, updated_state = scan_audit_log_for_storms_and_residuals(
            audit_log_path=args.audit_log,
            state=updated_state,
            channel_id=args.slack_channel,
            thread_ts=args.slack_thread_ts,
            dry_run=args.dry_run,
            log_path=log_path,
        )
        proc_residuals = scan_running_processes_for_residuals(
            channel_id=args.slack_channel,
            thread_ts=args.slack_thread_ts,
            dry_run=args.dry_run,
            log_path=log_path,
        )

        # Enforce log cap on audit log (<10MB max-size=10m max-file=3)
        if os.path.exists(args.audit_log) and not args.dry_run:
            try:
                sys.path.insert(0, str(Path(__file__).resolve().parent))
                from opa_gate_log_cap import rotate_log
                rotate_log(args.audit_log)
            except Exception as e:
                if args.verbose:
                    sys.stderr.write(f"[watchdog] Log cap check: {e}\n")

    # Persist state unless dry-run
    if not args.dry_run:
        save_state(args.state_file, updated_state)

    if args.json:
        report = {
            "mode": "incremental",
            "targets_checked": len(targets),
            "drift_events_count": len(events),
            "events": [
                {
                    "ts": ev.ts,
                    "iso_time": ev.iso_time(),
                    "target": ev.target.target_path,
                    "kind": ev.target.kind,
                    "from": ev.from_ref,
                    "to": ev.to_ref,
                    "action": ev.raw_msg,
                }
                for ev in events
            ],
            "deny_storms": storm_events,
            "residuals": residual_events + proc_residuals,
        }
        print(json.dumps(report, indent=2))
    elif args.verbose or events or storm_events or residual_events or proc_residuals:
        print(
            f"[watchdog] Scan finished. Checked {len(targets)} targets. "
            f"Drift events: {len(events)}. Deny-storms: {len(storm_events)}. "
            f"Residuals: {len(residual_events) + len(proc_residuals)}."
        )
        for ev in events:
            print(f"  {ev.human_str()}")
        for sa in storm_events:
            print(f"  [DENY_STORM] {sa['count']} denials in {sa['window_s']}s (cwd: {sa['cwd']})")
        for ra in residual_events:
            print(f"  [RESIDUAL_PATH] {ra['command']}")
        for pa in proc_residuals:
            print(f"  [ACTIVE_RESIDUAL_PROC] PID {pa['pid']} ({pa['user']}): {pa['args']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
