# METADATA
# scope: package
# required_events: ["PreToolUse"]
# required_tools: ["Bash"]
package cupcake.policies.cc_safety_net_parity

import rego.v1

# ──────────────────────────────────────────────────────────────────
# Tokenizer helpers — parse input.tool_input.command into tokens
# ──────────────────────────────────────────────────────────────────

tokens := split_command(input)

split_command(cmd) := toks if {
	toks := regex.split("[ \t]+", trim(cmd.tool_input.command, " \t"))
}

program := lower(tokens[0]) if {
	count(tokens) > 0
}

subcommand := tokens[1] if {
	count(tokens) > 1
}

subcommand := "" if {
	count(tokens) <= 1
}

args := tokens

# True if any token in `arr` appears in the full token list `toks`.
has_token(arr, toks) if {
	some t in arr
	toks[_] == t
}

# True if any token in `toks` starts with one of `prefixes`.
has_prefix(prefixes, toks) if {
	some p in prefixes
	some t in toks
	startswith(t, p)
}

# ──────────────────────────────────────────────────────────────────
# Rules — 42 cc-safety-net user rulebook rules (verbatim name + reason)
# Matching semantics mirror the rulebook: command + optional subcommand
# + ANY block_args token present (OR over block_args).
# ──────────────────────────────────────────────────────────────────

deny contains {"rule_id": "block-git-commit-am", "reason": "git commit -am stages ALL tracked modifications indiscriminately. Use git add <file> then git commit -m instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "commit"
	has_token(["-am", "-a"], args)
}

deny contains {"rule_id": "block-git-rebase-continue", "reason": "git rebase --continue/--skip/--abort should be run intentionally by the user. Auto-continuing rebases can commit unintended changes.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "rebase"
	has_token(["--continue", "--skip", "--abort"], args)
}

deny contains {"rule_id": "block-bd-notes-flag", "reason": "Use --append-notes instead to preserve existing notes and maintain audit trail.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "bd"
	has_token(["--notes"], args)
}

deny contains {"rule_id": "block-stop-docker-entirely", "reason": "Direct container stop is blocked to protect service availability. Use orchestrated workflows or the API to manage service termination.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "stop"
	has_token(["stop"], args)
}

deny contains {"rule_id": "block-kill-docker-entirely", "reason": "Direct container kill is blocked. Abrupt termination causes data corruption in LiteLLM/Postgres. Use the API for graceful shutdown.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "kill"
	has_token(["kill"], args)
}

deny contains {"rule_id": "block-rm-docker-entirely", "reason": "Direct container removal is blocked. Re-deploying manually bypasses the infrastructure-as-code state. Use Nomad/Ansible for removal.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "rm"
	has_token(["rm"], args)
}

deny contains {"rule_id": "block-restart-docker-entirely", "reason": "NEVER restart containers directly. This bypasses service orchestration (Nomad/Consul) and can lead to inconsistent state or data loss. Use the API or Nomad to manage service lifecycle.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "restart"
	has_token(["restart"], args)
}

deny contains {"rule_id": "block-exec-docker-entirely", "reason": "Direct exec into containers is blocked for security and integrity. Container states must be managed via configuration, not manual shell access. Use the API for troubleshooting.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "exec"
	has_token(["exec"], args)
}

deny contains {"rule_id": "block-update-docker-entirely", "reason": "Direct resource updates are blocked. Use Nomad job specs to adjust CPU/Memory limits.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "update"
	has_token(["update"], args)
}

deny contains {"rule_id": "block-rename-docker-entirely", "reason": "Container renaming is blocked to prevent breaking service discovery and monitoring tools.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "rename"
	has_token(["rename"], args)
}

deny contains {"rule_id": "block-volume-rm-docker-entirely", "reason": "Direct volume removal is strictly blocked to prevent permanent data loss. Volumes must be managed via Nomad/Ansible job specs.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "volume"
	has_token(["rm", "prune"], args)
}

deny contains {"rule_id": "block-volume-create-docker-entirely", "reason": "Manual volume creation is blocked to maintain infrastructure-as-code consistency. Define volumes in mise tasks or Nomad jobs.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "volume"
	has_token(["create"], args)
}

deny contains {"rule_id": "block-compose-down-litellm-services", "reason": "NEVER bring down litellm/litellm-local/omniroute via docker compose down. Removes containers, networks, and potentially volumes. Use the API to manage services instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "compose"
	has_token(["down", "--project-name=litellm", "--project-name=litellm-local", "--project-name=omniroute"], args)
}

deny contains {"rule_id": "block-compose-rm-litellm-services", "reason": "NEVER remove litellm/litellm-local/omniroute containers via docker compose rm. Use the API to manage services instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "compose"
	has_token(["rm", "--project-name=litellm", "--project-name=litellm-local", "--project-name=omniroute"], args)
}

deny contains {"rule_id": "block-compose-stop-litellm-services", "reason": "NEVER stop litellm/litellm-local/omniroute via docker compose. Use the API to manage them instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "docker"
	subcommand == "compose"
	has_token(["--target=litellm", "--target=litellm-local", "--target=omniroute"], args)
}

deny contains {"rule_id": "block-git-stash-mutations", "reason": "Do not mutate stashes in shared work. Others may be working in this directory. Read-only stash operations (list, show, branch, log) are allowed. If action is truly needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "stash"
	has_token(["push", "pop", "drop", "clear", "store", "create", "save"], args)
}

deny contains {"rule_id": "block-git-reset-hard", "reason": "Hard reset discards local work and can remove others' changes. Use safer targeted operations. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "reset"
	has_token(["--hard"], args)
}

deny contains {"rule_id": "block-git-reset-mixed", "reason": "Mixed reset rewrites index state and can disrupt shared dirty work. Use explicit file-level actions. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "reset"
	has_token(["--mixed"], args)
}

deny contains {"rule_id": "block-git-reset-merge", "reason": "Reset modes can unexpectedly alter local changes in shared directories. Prefer explicit safe steps. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "reset"
	has_token(["--merge", "--keep"], args)
}

deny contains {"rule_id": "block-git-clean-force", "reason": "git clean can permanently remove untracked files from collaborators. Use targeted cleanup only. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "clean"
	has_token(["-f", "-fd", "-fdx", "-xdf", "--force", "-x", "-d"], args)
}

deny contains {"rule_id": "block-git-checkout-discard", "reason": "checkout -- discards local file changes and may delete others' edits. Use explicit review-first workflows. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "checkout"
	has_token(["--"], args)
}

deny contains {"rule_id": "block-git-restore-worktree", "reason": "git restore can discard tracked modifications in shared worktrees. Prefer explicit file-safe steps. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "restore"
	has_token(["--worktree", "--source=HEAD"], args)
}

deny contains {"rule_id": "block-git-add-all", "reason": "git add -A / -a stages ALL changed files indiscriminately. Always use 'git add <specific-file>' or 'git add <directory>/' to stage intentionally. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "add"
	has_token(["-A", "--all", "-a"], args)
}

deny contains {"rule_id": "block-git-add-dot", "reason": "git add . stages ALL files in the current directory recursively. Always use 'git add <specific-file>' or 'git add <directory>/' to stage intentionally. If needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "add"
	has_token(["."], args)
}

deny contains {"rule_id": "block-git-commit-no-verify", "reason": "ALWAYS run pre-commit hooks. Bypassing hooks risks committing broken or unvalidated code. If action is truly needed, provide a single-line command humans can copy and run as-is.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "commit"
	has_token(["--no-verify", "-n"], args)
}

deny contains {"rule_id": "block-git-checkout-branch-reset", "reason": "git checkout -B force-resets branch refs and can temporarily orphan large local histories. Use explicit merge workflows instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "checkout"
	has_token(["-B"], args)
}

deny contains {"rule_id": "block-git-switch-force-create", "reason": "git switch -C force-resets branch refs and can rewrite the current branch unexpectedly. Use explicit safe branch operations instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "switch"
	has_token(["-C"], args)
}

deny contains {"rule_id": "block-git-branch-force-move", "reason": "Forced branch moves or renames can rewrite refs and hide work unexpectedly. Use review-first branch operations instead.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "branch"
	has_token(["-f", "-M", "-C"], args)
}

deny contains {"rule_id": "block-git-rebase-entirely", "reason": "Rebase rewrites commit history and is blocked in this environment. Merge instead of rebasing shared or valuable branch histories.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "git"
	subcommand == "rebase"
	has_token(["rebase"], args)
}

deny contains {"rule_id": "allow-rm-bd-sub-skills", "reason": "Allow deleting deprecated bd sub-skill directories. User explicitly requested consolidation.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "rm"
	has_token(["bd-workflow", "bd-planning", "bd-troubleshoot", "bd-config", "bd-workflow-init", "bd-formula-workflow", "bd-worktree", "bd-as-doc"], args)
}

deny contains {"rule_id": "allow-rm-beads-subdirs", "reason": "Allow removing symlink subdirs in beads/ skill. User explicitly requested beads as standalone.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "rm"
	has_token(["adr", "references", "resources"], args)
}

deny contains {"rule_id": "block-gcloud-destructive-verbs", "reason": "Mutation-capable gcloud operations are blocked by default to protect cloud resources, especially Cloud Run, Cloud SQL, and other serverless services.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "gcloud"
	has_token(["create", "delete", "update", "replace", "patch", "deploy", "undelete", "restore", "restore-backup", "clone", "import", "export", "execute", "failover", "switchover"], args)
}

deny contains {"rule_id": "block-bq-destructive-verbs", "reason": "BigQuery mutation commands are blocked by default to protect datasets, tables, jobs, and IAM configuration.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "bq"
	has_token(["mk", "rm", "update", "load", "insert", "truncate", "set-iam-policy", "add-iam-policy-binding", "remove-iam-policy-binding"], args)
}

deny contains {"rule_id": "block-gh-repo-delete-or-archive", "reason": "Destructive GitHub repository lifecycle actions are blocked by default.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "gh"
	subcommand == "repo"
	has_token(["delete", "archive"], args)
}

deny contains {"rule_id": "block-gh-public-repo-create", "reason": "Public GitHub repository creation is blocked by default. Create repos as private/internal only unless explicitly approved by a human.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "gh"
	subcommand == "repo"
	has_token(["--public"], args)
}

deny contains {"rule_id": "block-gh-visibility-change", "reason": "GitHub repository visibility changes are blocked by default to prevent accidental public exposure.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "gh"
	subcommand == "repo"
	has_token(["--visibility"], args)
}

deny contains {"rule_id": "block-glab-repo-delete-or-archive", "reason": "Destructive GitLab repository lifecycle actions are blocked by default.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "glab"
	subcommand == "repo"
	has_token(["delete", "archive"], args)
}

deny contains {"rule_id": "block-glab-public-repo-create", "reason": "Public GitLab repository creation is blocked by default. Create repos as private/internal only unless explicitly approved by a human.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "glab"
	subcommand == "repo"
	has_token(["--public"], args)
}

deny contains {"rule_id": "block-tmux-kill-server", "reason": "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "tmux"
	subcommand == "kill-server"
}

deny contains {"rule_id": "block-tmux-kill-session", "reason": "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "tmux"
	subcommand == "kill-session"
}

deny contains {"rule_id": "block-pkill-tmux-wezterm", "reason": "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "pkill"
	has_token(["tmux", "wezterm", "wezterm-mux-server"], args)
}

deny contains {"rule_id": "block-killall-tmux-wezterm", "reason": "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves.", "severity": "high"} if {
	input.hook_event_name == "PreToolUse"
	input.tool_name == "Bash"
	program == "killall"
	has_token(["tmux", "wezterm", "wezterm-mux-server"], args)
}
