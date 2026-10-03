#!/usr/bin/env python3
"""
scripts/run-p5-matrix.py — Universal Shell Gate Phase P5 Matrix Runner
Tests E1–E10 across 10 execution contexts in:
- MAIN fixture (slack-configuration)
- Young worktree (<3d) fixture (slack-configuration-wt)
- Old worktree (>=3d) fixture (slack-core-extraction)
Plus cheat-attempt residual probes.
Outputs JSONL to flow/findings/2026-10-03-universal-shell-gate/
"""

import json
import os
import subprocess
import sys
import time

MAIN_DIR = "/home/bhd/Documents/Projects/bhd/slack-configuration"
YOUNG_WT = "/home/bhd/Documents/Projects/bhd/slack-configuration-wt"
OLD_WT = "/home/bhd/Documents/Projects/bhd/slack-configuration/.claude/worktrees/slack-core-extraction"
OUT_DIR = "/home/bhd/Documents/Projects/bhd/opa-net/wt/universal-shell-gate/flow/findings/2026-10-03-universal-shell-gate"

ESCAPES = [
    ("E1", "git checkout feat/p5-test"),
    ("E2", "git switch feat/p5-test"),
    ("E3", "git checkout -b feat/p5-new"),
    ("E4", "git checkout origin/feat/p5-remote"),
    ("E5", "git checkout --detach"),
    ("E6", "git switch -c feat/p5-new2"),
    ("E7", "git worktree add /tmp/p5-evil-wt feat/p5-wt"),
    ("E8", "git symbolic-ref HEAD refs/heads/feat/p5-sym"),
    ("E9", "git update-ref refs/heads/main HEAD~1"),
    ("E10", f"git -C {MAIN_DIR} checkout feat/p5-c"),
]

CONTEXTS = [
    ("fresh_ssh_login", "ssh -o BatchMode=yes -o StrictHostKeyChecking=no localhost 'bash -lc \"cd {cwd} && {cmd}\"'"),
    ("ssh_non_login", "ssh -o BatchMode=yes -o StrictHostKeyChecking=no localhost 'cd {cwd} && {cmd}'"),
    ("bash_lc", "bash -lc 'cd {cwd} && {cmd}'"),
    ("bash_c", "bash -lc 'cd {cwd} && bash -c \"{cmd}\"'"),
    ("sh_c", "bash -lc 'cd {cwd} && sh -c \"{cmd}\"'"),
    ("env_i_login", "env -i /bin/bash -lc 'cd {cwd} && {cmd}'"),
    ("sudo", "sudo sh -c 'cd {cwd} && {cmd}'"),
    ("sudo_i", "sudo -i sh -c 'cd {cwd} && {cmd}'"),
    ("systemd_run", "systemd-run --user --pipe /bin/sh -c 'cd {cwd} && {cmd}'"),
    ("tmux", "rm -f /tmp/mat.out /tmp/mat.rc; tmux new-session -d -s mat-run 'cd {cwd} && {cmd} > /tmp/mat.out 2>&1; echo $? > /tmp/mat.rc'; sleep 1; tmux kill-session -t mat-run 2>/dev/null"),
]

os.makedirs(OUT_DIR, exist_ok=True)

def run_test(cmd_wrapper):
    try:
        res = subprocess.run(
            cmd_wrapper,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
        )
        # Check tmux file output if tmux context
        if "mat.out" in cmd_wrapper:
            out = open("/tmp/mat.out", "r").read() if os.path.exists("/tmp/mat.out") else ""
            rc = int(open("/tmp/mat.rc", "r").read().strip()) if os.path.exists("/tmp/mat.rc") else res.returncode
            return rc, out, out
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "TIMEOUT"

def clean_wt():
    subprocess.run("git -C " + OLD_WT + " checkout feat/slack-core-extraction 2>/dev/null", shell=True)
    subprocess.run("git -C " + OLD_WT + " branch -D feat/p5-new feat/p5-new2 feat/p5-sym 2>/dev/null", shell=True)
    subprocess.run("rm -rf /tmp/p5-evil-wt", shell=True)
    subprocess.run("git -C " + OLD_WT + " worktree prune 2>/dev/null", shell=True)

print("=== Running Matrix on MAIN Fixture ===")
main_results = []
for e_id, e_cmd in ESCAPES:
    for ctx_id, ctx_tpl in CONTEXTS:
        wrapped = ctx_tpl.format(cwd=MAIN_DIR, cmd=e_cmd)
        rc, stdout, stderr = run_test(wrapped)
        denied = (rc == 2 and ("BLOCKED" in stderr or "BLOCKED" in stdout))
        record = {
            "escape_id": e_id,
            "command": e_cmd,
            "context": ctx_id,
            "fixture": "MAIN",
            "returncode": rc,
            "verdict": "DENY" if denied else "ALLOW",
            "expected": "DENY",
            "passed": denied,
            "output": (stderr.strip() or stdout.strip()).splitlines()[0] if (stderr.strip() or stdout.strip()) else "",
        }
        main_results.append(record)
        status = "OK" if record["passed"] else "FAIL"
        print(f"[{status}] {e_id} x {ctx_id:18}: {record['verdict']} (rc={rc})")

with open(os.path.join(OUT_DIR, "matrix-main.jsonl"), "w") as f:
    for r in main_results:
        f.write(json.dumps(r) + "\n")

print(f"\nMAIN Summary: {sum(1 for r in main_results if r['passed'])}/{len(main_results)} passed.")

print("\n=== Running Matrix on Young Worktree (<3d) Fixture ===")
young_results = []
for e_id, e_cmd in ESCAPES:
    wrapped = f"PATH=/opt/opa-gate/bin:$PATH {e_cmd}"
    rc, stdout, stderr = run_test(f"cd {YOUNG_WT} && {wrapped}")
    denied = (rc == 2 and ("BLOCKED" in stderr or "BLOCKED" in stdout))
    record = {
        "escape_id": e_id,
        "command": e_cmd,
        "fixture": "young_wt",
        "returncode": rc,
        "verdict": "DENY" if denied else "ALLOW",
        "expected": "DENY",
        "passed": denied,
        "output": (stderr.strip() or stdout.strip()).splitlines()[0] if (stderr.strip() or stdout.strip()) else "",
    }
    young_results.append(record)
    status = "OK" if record["passed"] else "FAIL"
    print(f"[{status}] {e_id}: {record['verdict']} (rc={rc})")

with open(os.path.join(OUT_DIR, "matrix-young-wt.jsonl"), "w") as f:
    for r in young_results:
        f.write(json.dumps(r) + "\n")

print(f"Young WT Summary: {sum(1 for r in young_results if r['passed'])}/{len(young_results)} passed.")

print("\n=== Running Matrix on Old Worktree (>=3d) Fixture ===")
clean_wt()
old_results = []
for e_id, e_cmd in ESCAPES:
    wrapped = f"PATH=/opt/opa-gate/bin:$PATH {e_cmd}"
    rc, stdout, stderr = run_test(f"cd {OLD_WT} && {wrapped}")
    # In old worktree, branch gate should NOT fire (exit code != 2 or no branch gate deny)
    # E7 is blocked by global worktree path allowlist (/tmp is blocked), which is expected
    gate_denied = (rc == 2 and "branch" in (stderr + stdout).lower())
    record = {
        "escape_id": e_id,
        "command": e_cmd,
        "fixture": "old_wt",
        "returncode": rc,
        "branch_gate_denied": gate_denied,
        "verdict": "ALLOW" if not gate_denied else "DENY",
        "expected": "ALLOW",
        "passed": not gate_denied,
        "output": (stderr.strip() or stdout.strip()).splitlines()[0] if (stderr.strip() or stdout.strip()) else "",
    }
    old_results.append(record)
    status = "OK" if record["passed"] else "FAIL"
    print(f"[{status}] {e_id}: {record['verdict']} (rc={rc})")
clean_wt()

with open(os.path.join(OUT_DIR, "matrix-old-wt.jsonl"), "w") as f:
    for r in old_results:
        f.write(json.dumps(r) + "\n")

print(f"Old WT Summary: {sum(1 for r in old_results if r['passed'])}/{len(old_results)} passed.")

print("\n=== Running Cheat-Attempt Probes (Residuals) ===")
PROBES = [
    ("C1", "/usr/bin/git checkout feat/p5-cheat", "Absolute path invocation bypasses PATH resolution"),
    ("C2", "env PATH=/usr/bin git checkout feat/p5-cheat", "Explicit PATH override bypasses /opt/opa-gate/bin"),
    ("C3", "echo feat/p5-cheat | xargs /usr/bin/git checkout", "xargs direct binary invocation bypasses PATH"),
]
residual_results = []
for c_id, c_cmd, c_rationale in PROBES:
    rc, stdout, stderr = run_test(f"cd {MAIN_DIR} && {c_cmd}")
    bypassed = (rc != 2)
    record = {
        "probe_id": c_id,
        "command": c_cmd,
        "residual_category": "KNOWN_RESIDUAL_RED",
        "bypassed_shim": bypassed,
        "rationale": c_rationale,
        "mitigation": "S8 reflog watchdog + audit.jsonl scanner alerts on absolute-path git usage",
        "output": (stderr.strip() or stdout.strip()).splitlines()[0] if (stderr.strip() or stdout.strip()) else "",
    }
    residual_results.append(record)
    print(f"[KNOWN_RESIDUAL_RED] {c_id}: {c_cmd} (bypassed={bypassed})")

with open(os.path.join(OUT_DIR, "matrix-residuals.jsonl"), "w") as f:
    for r in residual_results:
        f.write(json.dumps(r) + "\n")

print("\nAll matrices generated successfully.")

