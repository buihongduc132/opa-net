#!/usr/bin/env python3
"""
Unit tests for branch_drift_watchdog.py (S8 reflog watchdog).
"""

import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Add repo root and script dir to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from branch_drift_watchdog import (
    DEFAULT_ALLOWLIST,
    ProtectedTarget,
    append_watchdog_log,
    clean_ref_name,
    detect_branch_drift,
    discover_protected_targets,
    get_reflog_first_entry,
    load_state,
    parse_reflog_line,
    save_state,
    scan_incremental,
)


class TestReflogParsing(unittest.TestCase):
    def test_parse_reflog_line_standard(self):
        line = "7eea677dc681c8f63988b23ea2a3e38bb809d4e1 12b04b9788b61f1d057aa8262cacf20fa7ad2ce5 buihongduc132 <buihongduc132@gmail.com> 1790754660 +0700\tcommit: feat"
        res = parse_reflog_line(line)
        self.assertIsNotNone(res)
        old_sha, new_sha, ts, msg = res
        self.assertEqual(old_sha, "7eea677dc681c8f63988b23ea2a3e38bb809d4e1")
        self.assertEqual(new_sha, "12b04b9788b61f1d057aa8262cacf20fa7ad2ce5")
        self.assertEqual(ts, 1790754660)
        self.assertEqual(msg, "commit: feat")

    def test_parse_reflog_line_name_with_spaces(self):
        line = "0000000000000000000000000000000000000000 8b3706d11e5444468e321d3801a09eb92ac13e05 Duc Bui <duc.bui@beetroot.se> 1790762427 +0700"
        res = parse_reflog_line(line)
        self.assertIsNotNone(res)
        old_sha, new_sha, ts, msg = res
        self.assertEqual(old_sha, "0000000000000000000000000000000000000000")
        self.assertEqual(new_sha, "8b3706d11e5444468e321d3801a09eb92ac13e05")
        self.assertEqual(ts, 1790762427)
        self.assertEqual(msg, "")

    def test_parse_reflog_line_invalid(self):
        self.assertIsNone(parse_reflog_line("not a reflog line"))
        self.assertIsNone(parse_reflog_line(""))


class TestDriftDetection(unittest.TestCase):
    def test_checkout_to_feature_branch_detected(self):
        msg = "checkout: moving from main to wt/agy-mcp-bridge-doc"
        drift = detect_branch_drift(msg, DEFAULT_ALLOWLIST)
        self.assertIsNotNone(drift)
        action, from_b, to_b = drift
        self.assertEqual(action, "checkout")
        self.assertEqual(from_b, "main")
        self.assertEqual(to_b, "wt/agy-mcp-bridge-doc")

    def test_checkout_to_allowed_branch_passes(self):
        for allowed in ["main", "dev", "staging", "test", "stag", "master"]:
            msg = f"checkout: moving from feature-branch to {allowed}"
            self.assertIsNone(detect_branch_drift(msg, DEFAULT_ALLOWLIST))

    def test_checkout_same_branch_passes(self):
        msg = "checkout: moving from main to main"
        self.assertIsNone(detect_branch_drift(msg, DEFAULT_ALLOWLIST))
        msg2 = "checkout: moving from feat-x to feat-x"
        self.assertIsNone(detect_branch_drift(msg2, DEFAULT_ALLOWLIST))

    def test_checkout_detached_detected(self):
        msg = "checkout: moving from main to HEAD"
        drift = detect_branch_drift(msg, DEFAULT_ALLOWLIST)
        self.assertIsNotNone(drift)
        _, from_b, to_b = drift
        self.assertEqual(from_b, "main")
        self.assertEqual(to_b, "HEAD")

    def test_branch_rename_detected(self):
        msg = "Branch: renamed refs/heads/main to refs/heads/custom-feature"
        drift = detect_branch_drift(msg, DEFAULT_ALLOWLIST)
        self.assertIsNotNone(drift)
        action, from_b, to_b = drift
        self.assertEqual(action, "rename")
        self.assertEqual(to_b, "custom-feature")

    def test_other_actions_pass(self):
        self.assertIsNone(detect_branch_drift("commit: feat(x): do work", DEFAULT_ALLOWLIST))
        self.assertIsNone(detect_branch_drift("merge origin/main: Fast-forward", DEFAULT_ALLOWLIST))
        self.assertIsNone(detect_branch_drift("rebase (finish): returning to refs/heads/main", DEFAULT_ALLOWLIST))
        self.assertIsNone(detect_branch_drift("pull --rebase origin main", DEFAULT_ALLOWLIST))


class TestTargetDiscoveryAndAge(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="watchdog_test_")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_discover_main_and_worktrees_age_boundary(self):
        now_ts = 1790995000.0  # reference time

        # 1. Create main repo
        main_repo = os.path.join(self.test_dir, "myrepo")
        os.makedirs(os.path.join(main_repo, ".git", "logs"), exist_ok=True)
        head_log = os.path.join(main_repo, ".git", "logs", "HEAD")
        with open(head_log, "w") as fp:
            fp.write(f"0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 user <u@test> {int(now_ts - 1000000)} +0000\tcommit: init\n")

        # 2. Add young worktree (1 day old)
        wt_young_meta = os.path.join(main_repo, ".git", "worktrees", "wt-young")
        os.makedirs(os.path.join(wt_young_meta, "logs"), exist_ok=True)
        with open(os.path.join(wt_young_meta, "gitdir"), "w") as fp:
            fp.write(f"{self.test_dir}/myrepo-wt-young/.git\n")
        with open(os.path.join(wt_young_meta, "logs", "HEAD"), "w") as fp:
            fp.write(f"0000000000000000000000000000000000000000 2222222222222222222222222222222222222222 user <u@test> {int(now_ts - 86400)} +0000\n")

        # 3. Add old worktree (4 days old)
        wt_old_meta = os.path.join(main_repo, ".git", "worktrees", "wt-old")
        os.makedirs(os.path.join(wt_old_meta, "logs"), exist_ok=True)
        with open(os.path.join(wt_old_meta, "gitdir"), "w") as fp:
            fp.write(f"{self.test_dir}/myrepo-wt-old/.git\n")
        with open(os.path.join(wt_old_meta, "logs", "HEAD"), "w") as fp:
            fp.write(f"0000000000000000000000000000000000000000 3333333333333333333333333333333333333333 user <u@test> {int(now_ts - 4 * 86400)} +0000\n")

        targets = discover_protected_targets([self.test_dir], protect_days=3.0, now_ts=now_ts)
        target_kinds = {t.repo_name: t.kind for t in targets}

        self.assertIn("myrepo", target_kinds)
        self.assertEqual(target_kinds["myrepo"], "MAIN")

        self.assertIn("myrepo [wt-young]", target_kinds)
        self.assertEqual(target_kinds["myrepo [wt-young]"], "YOUNG_WORKTREE")

        # Old worktree (4 days old) MUST NOT be included
        self.assertNotIn("myrepo [wt-old]", target_kinds)


class TestIncrementalScanningAndPersistence(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="watchdog_state_test_")
        self.state_file = os.path.join(self.test_dir, "watchdog-state.json")
        self.log_file = os.path.join(self.test_dir, "watchdog.log")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_state_atomic_save_and_load(self):
        data = {"version": 1, "last_scan_ts": 12345, "files": {"foo": {"offset": 100}}}
        save_state(self.state_file, data)
        loaded = load_state(self.state_file)
        self.assertEqual(loaded["last_scan_ts"], 12345)
        self.assertEqual(loaded["files"]["foo"]["offset"], 100)

    def test_incremental_scan_and_drift_detection(self):
        t0 = 1790995000.0
        repo_dir = os.path.join(self.test_dir, "testrepo")
        os.makedirs(os.path.join(repo_dir, ".git", "logs"), exist_ok=True)
        head_log = os.path.join(repo_dir, ".git", "logs", "HEAD")

        # Initial commit + checkout allowed
        with open(head_log, "w") as fp:
            fp.write(f"0000000000000000000000000000000000000000 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa user <u@test> {int(t0)} +0000\tcommit (initial): init\n")
            fp.write(f"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa user <u@test> {int(t0 + 10)} +0000\tcheckout: moving from main to dev\n")

        target = ProtectedTarget(
            kind="MAIN",
            repo_name="testrepo",
            target_path=repo_dir,
            reflog_path=head_log,
            age_days=0.0,
            creation_ts=int(t0),
        )

        state = {"version": 1, "last_scan_ts": 0, "files": {}}
        events, updated_state = scan_incremental([target], state, DEFAULT_ALLOWLIST, t0 + 20)
        self.assertEqual(len(events), 0)  # dev is allowed

        # Now append a drift event: moving from dev to rogue-feature
        t1 = t0 + 30
        with open(head_log, "a") as fp:
            fp.write(f"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb user <u@test> {int(t1)} +0000\tcheckout: moving from dev to rogue-feature\n")

        events2, updated_state2 = scan_incremental([target], updated_state, DEFAULT_ALLOWLIST, t1 + 5)
        self.assertEqual(len(events2), 1)
        self.assertEqual(events2[0].to_ref, "rogue-feature")
        self.assertEqual(events2[0].from_ref, "dev")

        # Test log append
        append_watchdog_log(self.log_file, events2[0], slack_ts="1790995030.123")
        self.assertTrue(os.path.exists(self.log_file))
        with open(self.log_file, "r", encoding="utf-8") as fp:
            log_content = fp.read()
        self.assertIn("Branch drift detected", log_content)
        self.assertIn("rogue-feature", log_content)

        # Third run with no new events produces zero events
        events3, _ = scan_incremental([target], updated_state2, DEFAULT_ALLOWLIST, t1 + 10)
        self.assertEqual(len(events3), 0)


if __name__ == "__main__":
    unittest.main()
