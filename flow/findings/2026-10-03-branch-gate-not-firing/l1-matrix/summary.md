# L1 Verification Proof — Branch-Gate E-Matrix (S6)

- Date: 2026-10-03
- Commit: `wt/branch-gate-fix-L1`
- Engine: `pi-opa-net` v0.7.0 (OPA v1.18.2)
- Roots Verified:
  - Global CLI: `/home/bhd/.local/share/mise/installs/node/22.22.2/lib/node_modules/pi-opa-net`
  - Stage-1 Prod: `/home/bhd/.pi/agent/packages/opa-net`
- Fixtures:
  1. Main Dir: `/home/bhd/Documents/Projects/bhd/slack-configuration` (`is_main_worktree: true`, `protected: true`)
  2. Old Worktree: `/home/bhd/Documents/Projects/bhd/slack-configuration/.claude/worktrees/slack-core-extraction` (`age_days: 3.99 >= 3`, `protected: false`)
  3. Fresh Worktree: `/tmp/fresh-wt-proof-matrix` (`age_days: 0.00 < 3`, `protected: true` under R2)

---

## E-Matrix Results

| # | Escape Command | Fixture 1: Main Dir (`slack-config`) | Fixture 2: Old WT (`slack-core-ext`) | Fixture 3: Young WT (`fresh-wt`) | Triggered Rule ID |
|---|---|---|---|---|---|
| E1 | `git checkout feature-unallowed` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:20e0233b`) |
| E2 | `git switch feature-unallowed` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:7586160d`) |
| E3 | `git checkout -b new-unallowed` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:04ea8165`) |
| E4 | `git checkout origin/remote-unallowed` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:197f575b`) |
| E5 | `git checkout --detach` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `block-git-checkout-detached` |
| E6 | `git switch -c new-unallowed` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:220ead37`) |
| E7 | `git worktree add .worktrees/test-lane unallowed-branch` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:6b7106f2`) |
| E8 | `git symbolic-ref HEAD refs/heads/unallowed-branch` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `block-git-symbolic-ref-head` |
| E9 | `git update-ref refs/heads/main 257f812` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `block-git-update-ref-branch` |
| E10 | `git -C <target-dir> checkout unallowed-branch` | **DENY (exit 2)** | **ALLOW (exit 0)** | **DENY (exit 2)** | `branch-target-allowlist` (`custom:3b73c773`) |

---

## Scorecard & Acceptance Verdict

- **Main Dir (Fixture 1):** 10/10 DENY (100% block rate)
- **Old Worktree (Fixture 2):** 10/10 ALLOW (100% free rate for worktree lanes >= 3 days)
- **Young Worktree (Fixture 3):** 10/10 DENY (100% protection under R2 for fresh worktrees < 3 days)
- **Engine Integrity:** 0 ajv errors, 0 fail-open anomalies. Valid `decision-output.v1` JSON returned for every evaluation.
- **Proof Files:**
  - `main-deny.jsonl` (10 raw evaluation records)
  - `old-wt-allow.jsonl` (10 raw evaluation records)
  - `young-wt-deny.jsonl` (10 raw evaluation records)
