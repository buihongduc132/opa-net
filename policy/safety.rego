# Example: cc-safety-net rules → OPA/Rego translation
# ----------------------------------------------------------------
# STATUS: explore artifact (NOT a deployed implementation).
# Purpose: demonstrate how each of the 38 current rules looks in OPA,
#          as evidence supporting locked decision [LD1] (engine = OPA).
#
# Scope: [LD3] bash command guarding ONLY. No other OPA logic here.
#
# Two-halves framing (from turn3):
#   1. PARSE  "git stash list" → {program, subcommand, args[]}
#      (the half OPA does NOT solve — open thread [OT1])
#   2. DECIDE {program, subcommand, args[]} → allow/deny
#      (the half this .rego implements)
#
# This file assumes the parse half produced a normalized struct:
#   input = {
#     program:    "git" | "docker" | "rm" | ...    (string, lowercase)
#     subcommand: "commit" | "stash" | ""          (string; "" if none)
#     args:       ["-am", "--hard", ...]           (array of strings)
#     raw:        "git stash list"                 (original string, for regex fallback)
#   }
#
# Fail-mode: `default allow := true` = fail-OPEN. Matches pi-safety-net
# fork's behavior. Fail-mode when OPA itself is down is [OT2] (open).

package safety

import rego.v1

# ──────────────────────────────────────────────────────────────────
# DEFAULT — fail-open base
# ──────────────────────────────────────────────────────────────────
default allow := true

# Any deny reason ⇒ block
allow := false if {
    count(deny) > 0
}

# ──────────────────────────────────────────────────────────────────
# HELPERS — arg matching
# ──────────────────────────────────────────────────────────────────

# True if any arg token exactly matches one of `tokens`
has_any_arg(args, tokens) if {
    some t in tokens
    args[_] == t
}

# True if any arg starts with one of `prefixes` (e.g. "--project-name=")
has_arg_prefix(args, prefixes) if {
    some p in prefixes
    some a in args
    startswith(a, p)
}

# True if the verb token sits in subcommand position (args[0]) — avoids
# matching user-controlled values (e.g. `pm2 start app --name restart`).
first_arg_in(args, tokens) if {
    some t in tokens
    args[0] == t
}

# ──────────────────────────────────────────────────────────────────
# GROUP A — git subcommand + blocked arg tokens
# (rule family: command + subcommand + block_args[])
# ──────────────────────────────────────────────────────────────────

deny[msg] if {
    input.program == "git"
    input.subcommand == "commit"
    has_any_arg(input.args, ["-am", "-a"])
    msg := "git commit -am stages ALL tracked modifications indiscriminately. Use explicit paths."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "commit"
    has_any_arg(input.args, ["--no-verify", "-n"])
    msg := "ALWAYS run pre-commit hooks. Bypassing hooks risks shipping broken changes."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "stash"
    has_any_arg(input.args, ["push", "pop", "drop", "clear", "store", "create", "save"])
    msg := "Do not mutate stashes in shared work. Others may be relying on them."
}

# BARE-DEFAULT (resolved [OT3]): `git stash` with no operation arg ≡ push.
# cc-safety-net could not express this (no token to match). OPA solves it —
# stash subcommand with zero args (list/show/branch carve-outs carry args).
deny[msg] if {
    input.program == "git"
    input.subcommand == "stash"
    count(input.args) == 0
    msg := "Bare `git stash` defaults to push. Use `git stash list/show` explicitly."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "reset"
    has_any_arg(input.args, ["--hard"])
    msg := "Hard reset discards local work and can remove others' uncommitted changes."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "reset"
    has_any_arg(input.args, ["--mixed"])
    msg := "Mixed reset rewrites index state and can disrupt shared work."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "reset"
    has_any_arg(input.args, ["--merge", "--keep"])
    msg := "Reset modes can unexpectedly alter local changes in shared work."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "clean"
    has_any_arg(input.args, ["-f", "-fd", "-fdx", "-xdf", "--force", "-x", "-d"])
    msg := "git clean can permanently remove untracked files from the working tree."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "checkout"
    has_any_arg(input.args, ["--"])
    msg := "checkout -- discards local file changes and may destroy others' work."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "checkout"
    has_any_arg(input.args, ["-B"])
    msg := "git checkout -B force-resets branch refs and can trash shared branches."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "restore"
    has_any_arg(input.args, ["--worktree", "--source=HEAD"])
    msg := "git restore can discard tracked modifications in shared work."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "add"
    has_any_arg(input.args, ["-A", "--all", "-a"])
    msg := "git add -A / -a stages ALL changed files indiscriminately. Use explicit paths."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "add"
    has_any_arg(input.args, ["."])
    msg := "git add . stages ALL files in the current directory indiscriminately."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "switch"
    has_any_arg(input.args, ["-C"])
    msg := "git switch -C force-resets branch refs and can rewrite shared history."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "branch"
    has_any_arg(input.args, ["-f", "-M", "-C"])
    msg := "Forced branch moves or renames can rewrite refs and disrupt shared work."
}

# Rebase — block the subcommand entirely (redundant in OPA: just check subcommand)
deny[msg] if {
    input.program == "git"
    input.subcommand == "rebase"
    msg := "Rebase rewrites commit history and is blocked in this environment."
}

# Rebase lifecycle verbs — but `rebase` itself is already blocked above,
# so these are belt-and-suspenders (covers `git rebase --continue` etc.)
deny[msg] if {
    input.program == "git"
    input.subcommand == "rebase"
    has_any_arg(input.args, ["--continue", "--skip", "--abort"])
    msg := "git rebase --continue/--skip/--abort should be run only with explicit approval."
}

# ──────────────────────────────────────────────────────────────────
# GROUP B — docker subcommands blocked entirely
# (rule family: command + subcommand == subcommand; block_args redundant)
# ──────────────────────────────────────────────────────────────────

docker_blocked_subcommands := {
    "stop":     "Direct container stop is blocked to protect services managed by Nomad.",
    "kill":     "Direct container kill is blocked. Abrupt termination risks data loss.",
    "rm":       "Direct container removal is blocked. Re-deploying via Nomad is safer.",
    "restart":  "NEVER restart containers directly. This bypasses scheduling safety.",
    "exec":     "Direct exec into containers is blocked for security.",
    "update":   "Direct resource updates are blocked. Use Nomad job specification.",
    "rename":   "Container renaming is blocked to prevent breaking service discovery.",
}

deny[msg] if {
    input.program == "docker"
    input.subcommand in object.keys(docker_blocked_subcommands)
    msg := docker_blocked_subcommands[input.subcommand]
}

deny[msg] if {
    input.program == "docker"
    input.subcommand == "volume"
    has_any_arg(input.args, ["rm", "prune"])
    msg := "Direct volume removal is strictly blocked to prevent data loss."
}

deny[msg] if {
    input.program == "docker"
    input.subcommand == "volume"
    has_any_arg(input.args, ["create"])
    msg := "Manual volume creation is blocked to maintain infra-as-code parity."
}

# ──────────────────────────────────────────────────────────────────
# GROUP C — docker compose with project-name / target filters
# (the carve-out family — block ONLY litellm/omniroute, not other projects)
# ──────────────────────────────────────────────────────────────────

litellm_projects := ["--project-name=litellm", "--project-name=litellm-local", "--project-name=omniroute"]
litellm_targets  := ["--target=litellm", "--target=litellm-local", "--target=omniroute"]

deny[msg] if {
    input.program == "docker"
    input.subcommand == "compose"
    has_any_arg(input.args, ["down"])
    has_arg_prefix(input.args, litellm_projects)
    msg := "NEVER bring down litellm/litellm-local/omniroute via docker compose."
}

deny[msg] if {
    input.program == "docker"
    input.subcommand == "compose"
    has_any_arg(input.args, ["rm"])
    has_arg_prefix(input.args, litellm_projects)
    msg := "NEVER remove litellm/litellm-local/omniroute containers via docker compose."
}

deny[msg] if {
    input.program == "docker"
    input.subcommand == "compose"
    has_arg_prefix(input.args, litellm_targets)
    msg := "NEVER stop litellm/litellm-local/omniroute via docker compose --target."
}

# ──────────────────────────────────────────────────────────────────
# GROUP D — command-level token blocks (no subcommand)
# ──────────────────────────────────────────────────────────────────

deny[msg] if {
    input.program == "bd"
    has_any_arg(input.args, ["--notes"])
    msg := "Use --append-notes instead to preserve existing notes."
}

# gcloud — mutation verbs
gcloud_blocked_verbs := [
    "create", "delete", "update", "replace", "patch", "deploy",
    "undelete", "restore", "restore-backup", "clone",
    "import", "export", "execute", "failover", "switchover",
]

deny[msg] if {
    input.program == "gcloud"
    # verb appears anywhere in args (gcloud nests: compute instances delete)
    some v in gcloud_blocked_verbs
    has_any_arg(input.args, [v])
    msg := sprintf("Mutation-capable gcloud operation '%s' is blocked by default.", [v])
}

# bq — mutation commands
bq_blocked_verbs := [
    "mk", "rm", "update", "load", "insert", "truncate",
    "set-iam-policy", "add-iam-policy-binding", "remove-iam-policy-binding",
]

deny[msg] if {
    input.program == "bq"
    some v in bq_blocked_verbs
    has_any_arg(input.args, [v])
    msg := sprintf("BigQuery mutation command '%s' is blocked by default.", [v])
}

# ──────────────────────────────────────────────────────────────────
# GROUP E — `rm` rules (the misnamed "allow-*" family)
# ──────────────────────────────────────────────────────────────────
#
# IMPORTANT (turn1 insight): the rules named `allow-rm-bd-sub-skills`
# and `allow-rm-beads-subdirs` are MISNAMED. In cc-safety-net they
# actually BLOCK those exact tokens (there is no carve-out primitive).
#
# In OPA we can express them two ways. The faithful translation
# (matches current behavior — blocks the named paths):
#
rm_bd_blocked := [
    "bd-workflow", "bd-planning", "bd-troubleshoot", "bd-config",
    "bd-workflow-init", "bd-formula-workflow", "bd-worktree", "bd-as-doc",
]

deny[msg] if {
    input.program == "rm"
    has_any_arg(input.args, rm_bd_blocked)
    msg := "Removing deprecated bd sub-skill directories is blocked (rule is misnamed 'allow')."
}

rm_beads_blocked := ["adr", "references", "resources"]

deny[msg] if {
    input.program == "rm"
    has_any_arg(input.args, rm_beads_blocked)
    msg := "Removing symlink subdirs in beads/ skill is blocked (rule is misnamed 'allow')."
}

# block-rm-rf-dangerous-target — guard against `rm -rf` on broad/cwd/system paths.
# Parser caveat: shell-quote expands globs (`*`, `/*`) and env vars (`$HOME`)
# during parsing, so those tokens vanish from input.args but survive in input.raw.
# We therefore check BOTH args (exact targets) and raw (regex fallback).

# Recursive flag: -r | -R | --recursive | combined short cluster containing r/R
rm_has_recursive(args) if { has_any_arg(args, ["-r", "-R", "--recursive"]) }
rm_has_recursive(args) if {
    some a in args
    startswith(a, "-")
    not startswith(a, "--")
    count(a) > 2
    contains(a, "r")
}
rm_has_recursive(args) if {
    some a in args
    startswith(a, "-")
    not startswith(a, "--")
    count(a) > 2
    contains(a, "R")
}

# Force flag: -f | --force | combined short cluster containing f
rm_has_force(args) if { has_any_arg(args, ["-f", "--force"]) }
rm_has_force(args) if {
    some a in args
    startswith(a, "-")
    not startswith(a, "--")
    count(a) > 2
    contains(a, "f")
}

# Non-flag target arguments
rm_targets(args) := [t | some t in args; not startswith(t, "-")]

# Dangerous targets visible in args (parser preserves literal ., .., /, ~, etc.)
rm_dangerous_arg_targets := ["/", "~", "$HOME", ".", "..", "/home", "/*", "~/*"]

rm_has_dangerous_arg_target(args) if {
    some t in rm_targets(args)
    t == rm_dangerous_arg_targets[_]
}

# Dangerous tokens that disappear from args due to shell expansion (globs, env vars).
# Matched as standalone words (whitespace or string boundary) in input.raw.
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)/\\*(\\s|$)", raw) }
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)~(/\\*)?(\\s|$)", raw) }
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)\\$HOME(\\s|$)", raw) }
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)/home(\\s|$)", raw) }
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)/(\\s|$)", raw) }
rm_raw_dangerous_token(raw) if { regex.match("(^|\\s)\\*(\\s|$)", raw) }

# Args-based deny: dangerous literal target present in args
deny[msg] if {
    input.program == "rm"
    rm_has_recursive(input.args)
    rm_has_force(input.args)
    rm_has_dangerous_arg_target(input.args)
    msg := "rm -rf on dangerous targets (/, ~, ., .., *, /*, $HOME, /home) is blocked. Use specific paths like /tmp/dir or ./subdir."
}

# Raw-based deny: dangerous glob/env token present in raw (disappeared from args)
deny[msg] if {
    input.program == "rm"
    rm_has_recursive(input.args)
    rm_has_force(input.args)
    rm_raw_dangerous_token(input.raw)
    msg := "rm -rf on dangerous targets (/, ~, ., .., *, /*, $HOME, /home) is blocked. Use specific paths like /tmp/dir or ./subdir."
}

# ──────────────────────────────────────────────────────────────────
# GROUP F — gh / glab repo lifecycle
# ──────────────────────────────────────────────────────────────────

deny[msg] if {
    input.program == "gh"
    input.subcommand == "repo"
    has_any_arg(input.args, ["delete", "archive"])
    msg := "Destructive GitHub repository lifecycle actions are blocked by default."
}

deny[msg] if {
    input.program == "gh"
    input.subcommand == "repo"
    has_any_arg(input.args, ["--public"])
    msg := "Public GitHub repository creation is blocked by default."
}

deny[msg] if {
    input.program == "gh"
    input.subcommand == "repo"
    has_any_arg(input.args, ["--visibility"])
    msg := "GitHub repository visibility changes are blocked by default."
}

deny[msg] if {
    input.program == "glab"
    input.subcommand == "repo"
    has_any_arg(input.args, ["delete", "archive"])
    msg := "Destructive GitLab repository lifecycle actions are blocked by default."
}

deny[msg] if {
    input.program == "glab"
    input.subcommand == "repo"
    has_any_arg(input.args, ["--public"])
    msg := "Public GitLab repository creation is blocked by default."
}

# ──────────────────────────────────────────────────────────────────
# GROUP G — tmux / pkill / killall session protection
# (cc-safety-net parity: block-tmux-kill-server, block-tmux-kill-session,
#  block-pkill-tmux-wezterm, block-killall-tmux-wezterm)
#
# The pi-opa-net parser treats tmux/pkill/killall as non-subcommand programs,
# so the kill verb lands in input.args. Messages are copied verbatim from the
# canonical rulebook reason field.
# ──────────────────────────────────────────────────────────────────

session_kill_targets := ["tmux", "wezterm", "wezterm-mux-server", "herdr", "bermuda"]

deny[msg] if {
    input.program == "tmux"
    has_any_arg(input.args, ["kill-server"])
    msg := "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves."
}

deny[msg] if {
    input.program == "tmux"
    has_any_arg(input.args, ["kill-session"])
    msg := "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves."
}

deny[msg] if {
    input.program == "pkill"
    has_any_arg(input.args, session_kill_targets)
    msg := "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves."
}

deny[msg] if {
    input.program == "killall"
    has_any_arg(input.args, session_kill_targets)
    msg := "Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically — hand the exact command back to the user and let them run it themselves."
}

# ──────────────────────────────────────────────────────────────────
# GROUP H — herdr session protection
# (herdr is a terminal workspace manager for AI coding agents;
#  killing it destroys active workspaces, sessions, and agent state.)
# ──────────────────────────────────────────────────────────────────

# Block `herdr server stop` — stops the herdr daemon.
deny[msg] if {
    input.program == "herdr"
    has_any_arg(input.args, ["server"])
    has_any_arg(input.args, ["stop"])
    msg := "Stopping the herdr server destroys all active workspaces, sessions, and agent state. Do NOT run this automatically — hand the exact command back to the user."
}

# Block `herdr session stop <name>` — stops a named session.
deny[msg] if {
    input.program == "herdr"
    has_any_arg(input.args, ["session"])
    has_any_arg(input.args, ["stop"])
    msg := "Stopping a herdr session destroys in-flight agent work. Do NOT run this automatically — hand the exact command back to the user."
}

# Block `herdr session delete <name>` — deletes a stopped session.
deny[msg] if {
    input.program == "herdr"
    has_any_arg(input.args, ["session"])
    has_any_arg(input.args, ["delete"])
    msg := "Deleting a herdr session removes persisted state. Do NOT run this automatically — hand the exact command back to the user."
}

# Block `herdr workspace close <name>` — closes a workspace.
deny[msg] if {
    input.program == "herdr"
    has_any_arg(input.args, ["workspace"])
    has_any_arg(input.args, ["close"])
    msg := "Closing a herdr workspace destroys active agent state. Do NOT run this automatically — hand the exact command back to the user."
}

# ──────────────────────────────────────────────────────────────────
# GROUP I — pulumi IaC safety
# (pulumi up --force / auto-approve bypasses the deployment preview;
#  destroy / stack rm / state delete are irreversible stack operations.)
# ──────────────────────────────────────────────────────────────────

# Block `pulumi up --force` and preview-bypassing flags.
deny[msg] if {
    input.program == "pulumi"
    input.subcommand == "up"
    has_any_arg(input.args, ["--force", "-f", "--skip-preview", "--yes", "-y"])
    msg := "pulumi up with --force/--yes/--skip-preview bypasses the deployment preview and applies changes without review. Run `pulumi preview` and apply only with explicit approval."
}

# Block `pulumi destroy` — tears down every resource in the stack.
deny[msg] if {
    input.program == "pulumi"
    input.subcommand == "destroy"
    msg := "pulumi destroy tears down ALL resources in the stack. Do NOT run this automatically — hand the exact command back to the user."
}

# Block `pulumi stack rm` — deletes the stack and its state.
deny[msg] if {
    input.program == "pulumi"
    input.subcommand == "stack"
    has_any_arg(input.args, ["rm", "remove"])
    msg := "pulumi stack rm deletes the stack and its state. Do NOT run this automatically — hand the exact command back to the user."
}

# Block `pulumi state delete` — removes resources from state (orphans real infra).
deny[msg] if {
    input.program == "pulumi"
    input.subcommand == "state"
    has_any_arg(input.args, ["delete", "unprotect"])
    msg := "pulumi state delete/unprotect mutates stack state and can orphan or expose real infrastructure. Do NOT run this automatically."
}

# ──────────────────────────────────────────────────────────────────
# GROUP J — DevOps destructive-CLI coverage
# (terraform/tofu/terragrunt, nomad, consul, vault, aws, pm2,
#  systemctl, dd; plus docker-compose v1 binary GROUP C parity.)
# All literal messages (Approach A): parity-test safe + LD-L1 stable
# rule_ids for unlock keys.
# ──────────────────────────────────────────────────────────────────

iac_programs := {"terraform", "tofu", "terragrunt"}

# Auto-approve flag in either exact or =value form.
iac_autoapprove(args) if {
    has_any_arg(args, ["-auto-approve", "--auto-approve", "-y"])
}
iac_autoapprove(args) if {
    has_arg_prefix(args, ["-auto-approve=", "--auto-approve="])
}

deny[msg] if {
    input.program in iac_programs
    input.subcommand == "destroy"
    msg := "terraform/tofu/terragrunt destroy tears down ALL resources managed by the stack. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program in iac_programs
    input.subcommand == "apply"
    iac_autoapprove(input.args)
    msg := "terraform/tofu/terragrunt apply -auto-approve bypasses the plan review prompt. Run `terraform plan` and apply only with explicit approval."
}

deny[msg] if {
    input.program in iac_programs
    input.subcommand == "state"
    has_any_arg(input.args, ["rm", "delete"])
    msg := "terraform/tofu/terragrunt state rm/delete removes resources from state and can orphan real infrastructure. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "terragrunt"
    input.subcommand == "run"
    has_any_arg(input.args, ["destroy"])
    msg := "terragrunt run destroy applies a destroy plan across the module tree. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "terragrunt"
    input.subcommand == "run"
    has_any_arg(input.args, ["apply"])
    iac_autoapprove(input.args)
    msg := "terragrunt run apply --auto-approve bypasses plan review across every module in the tree. Apply only with explicit approval."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "job"
    has_any_arg(input.args, ["stop", "deregister"])
    msg := "nomad job stop/deregister tears down scheduled work. Re-deploy via the Nomad job specification instead of manual stops."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "alloc"
    has_any_arg(input.args, ["stop", "signal", "restart"])
    msg := "Direct alloc stop/signal/restart bypasses scheduler safety. Use deployment-level operations instead."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "system"
    has_any_arg(input.args, ["gc"])
    msg := "nomad system gc force-garbage-collects the cluster and can disrupt running work. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "node"
    has_any_arg(input.args, ["drain", "eligibility"])
    msg := "nomad node drain/eligibility evicts all allocations from a node. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "deployment"
    has_any_arg(input.args, ["fail", "pause"])
    msg := "nomad deployment fail/pause aborts a rolling deployment mid-flight. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "nomad"
    input.subcommand == "volume"
    has_any_arg(input.args, ["detach"])
    msg := "nomad volume detach detaches storage from running work. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "consul"
    input.subcommand == "kv"
    has_any_arg(input.args, ["delete"])
    msg := "consul kv delete removes cluster configuration state. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "consul"
    input.subcommand == "services"
    has_any_arg(input.args, ["deregister"])
    msg := "consul services deregister breaks service discovery for the node. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "consul"
    input.subcommand in {"leave", "force-leave"}
    msg := "consul leave/force-leave removes the agent from the cluster. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "consul"
    input.subcommand == "operator"
    has_any_arg(input.args, ["remove-peer"])
    msg := "consul operator raft remove-peer mutates Raft consensus membership. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "vault"
    input.subcommand == "kv"
    has_any_arg(input.args, ["delete", "destroy"])
    msg := "vault kv delete/destroy removes secret data. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "vault"
    input.subcommand in {"secrets", "auth"}
    has_any_arg(input.args, ["disable"])
    msg := "vault secrets/auth disable turns off a secrets engine or auth method. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "vault"
    input.subcommand in {"token", "lease"}
    has_any_arg(input.args, ["revoke"])
    msg := "vault token/lease revoke invalidates credentials. Do NOT run this automatically."
}

deny[msg] if {
    input.program == "vault"
    input.subcommand == "seal"
    msg := "vault seal makes the Vault sealed and unavailable. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "vault"
    input.subcommand == "operator"
    has_any_arg(input.args, ["remove-peer"])
    msg := "vault operator raft remove-peer mutates Raft consensus membership. Do NOT run this automatically."
}

aws_blocked_verbs := [
    "terminate-instances", "stop-instances", "delete-bucket",
    "delete-stack", "delete-table", "delete-db-cluster", "delete-log-group",
]

deny[msg] if {
    input.program == "aws"
    some v in aws_blocked_verbs
    has_any_arg(input.args, [v])
    msg := "Destructive AWS operation tokens (terminate/stop/delete class) are blocked by default. Use read-only describe/list/get operations."
}

deny[msg] if {
    input.program == "aws"
    has_any_arg(input.args, ["s3"])
    has_any_arg(input.args, ["rm", "rb"])
    msg := "aws s3 rm/rb deletes objects or buckets. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "pm2"
    first_arg_in(input.args, ["kill", "delete", "stop", "restart"])
    msg := "pm2 kill/delete/stop/restart affects every managed node service. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "systemctl"
    first_arg_in(input.args, ["stop", "kill", "mask", "disable", "isolate"])
    msg := "systemctl stop/kill/mask/disable/isolate affects host services. Do NOT run this automatically — hand the exact command back to the user."
}

deny[msg] if {
    input.program == "dd"
    has_arg_prefix(input.args, [
        "of=/dev/sd", "of=/dev/nvme", "of=/dev/vd", "of=/dev/hd",
        "of=/dev/mmcblk", "of=/dev/loop", "of=/dev/md", "of=/dev/mapper",
    ])
    msg := "dd writing to a raw block device (of=/dev/*) can destroy disks beyond recovery. Do NOT run this automatically."
}

# docker-compose v1 standalone binary — GROUP C parity (parser keeps it
# flat-arg-shaped; flag-first forms never yield subcommand="compose").
deny[msg] if {
    input.program == "docker-compose"
    has_any_arg(input.args, ["down"])
    has_arg_prefix(input.args, litellm_projects)
    msg := "NEVER bring down litellm/litellm-local/omniroute via docker compose."
}

deny[msg] if {
    input.program == "docker-compose"
    has_any_arg(input.args, ["rm"])
    has_arg_prefix(input.args, litellm_projects)
    msg := "NEVER remove litellm/litellm-local/omniroute containers via docker compose."
}

deny[msg] if {
    input.program == "docker-compose"
    has_arg_prefix(input.args, litellm_targets)
    msg := "NEVER stop litellm/litellm-local/omniroute via docker compose --target."
}

# ──────────────────────────────────────────────────────────────────
# GROUP G — branch-target-allowlist (LD1)
# Deny git checkout/switch <X> when X ∉ allowed set AND in main worktree.
# signals.repo.is_main_worktree must be true (sub-worktrees roam free).
# ──────────────────────────────────────────────────────────────────

# Default allowed branches if data.config.allowed_branches is absent.
default_branches := {"dev", "staging", "main", "master"}

allowed_branches := branches if {
    branches := data.config.allowed_branches
} else := default_branches if {
    not data.config.allowed_branches
}

# Helper: signals.repo available and is_main_worktree is true.
repo_available_main_worktree if {
    input.signals.repo.available == true
    input.signals.repo.is_main_worktree == true
}

# Helper: target resolves as a local branch ref.
target_is_local_branch if {
    input.signals.git.target_kind == "branch"
    input.signals.git.target_branch != null
}

# Helper: array/set-agnostic membership test for allowed branches.
# data.config.allowed_branches may arrive as a JSON array; string-indexing
# an array is undefined, so use iteration-based membership instead.
branch_allowed(t) if {
    allowed_branches[_] == t
}

# Deny checkout to non-allowed branch from main worktree.
# Empty allowed_branches → rule inert (LD3).
deny[msg] if {
    input.program == "git"
    input.subcommand == "checkout"
    repo_available_main_worktree
    target_is_local_branch
    count(allowed_branches) > 0
    target := input.signals.git.target_branch
    not branch_allowed(target)
    msg := sprintf("branch-target-allowlist: checkout to non-allowed branch '%s'. Allowed: %v", [target, allowed_branches])
}

# Deny switch to non-allowed branch from main worktree.
# Empty allowed_branches → rule inert (LD3).
deny[msg] if {
    input.program == "git"
    input.subcommand == "switch"
    repo_available_main_worktree
    target_is_local_branch
    count(allowed_branches) > 0
    target := input.signals.git.target_branch
    not branch_allowed(target)
    msg := sprintf("branch-target-allowlist: switch to non-allowed branch '%s'. Allowed: %v", [target, allowed_branches])
}

# ──────────────────────────────────────────────────────────────────
# GROUP H — worktree-path-allowlist (LD5, LD6)
# Deny git worktree add/move/repair when canonicalized path ∉ allowed prefixes.
# Boundary-enforced prefix match done in TS (canonicalizePath).
# ──────────────────────────────────────────────────────────────────

# Default allowed worktree dirs if data.config.worktree_allowed_dirs is absent.
default_wt_dirs := {".worktrees", "worktrees"}

worktree_allowed_dirs := dirs if {
    dirs := data.config.worktree_allowed_dirs
} else := default_wt_dirs if {
    not data.config.worktree_allowed_dirs
}

# Helper: worktree subcommand that takes a path.
worktree_path_subcommand if {
    input.subcommand == "worktree"
    input.args[0] == "add"
}

worktree_path_subcommand if {
    input.subcommand == "worktree"
    input.args[0] == "move"
}

worktree_path_subcommand if {
    input.subcommand == "worktree"
    input.args[0] == "repair"
}

# Deny when TS-side canonicalization flagged path as not allowed.
# Empty worktree_allowed_dirs → rule inert (LD3).
deny[msg] if {
    input.program == "git"
    worktree_path_subcommand
    input.signals.worktree.available == true
    input.signals.worktree.path_allowed == false
    count(worktree_allowed_dirs) > 0
    reason := object.get(input.signals.worktree, "path_reject_reason", "unknown")
    path := object.get(input.signals.worktree, "target_path", "unknown")
    msg := sprintf("worktree-path-allowlist: %s for path '%s'", [reason, path])
}

# ──────────────────────────────────────────────────────────────────
# GROUP K — home-wide find / recursive hermes grep (BHD-165 / BHD-203)
# Deny class: home-WIDE prefix ($HOME/**, /home/<user>/**, ~/**) plus
#             recursive grep of ~/.hermes (incl. *.db).
# Allow class: cwd/repo scoped walks, known goal dirs, maxdepth<=2 under
#              <repo>/.worktrees. Fail-open (default allow := true) stays.
# Parser caveat: shell-quote expands `$HOME` to empty arg (same as rm -rf
# $HOME) so we match BOTH args and input.raw. maxdepth/-name/-mmin/-newermt
# do NOT exempt a home prefix. maxdepth<=2 is a REAL gate on .worktrees.
# ──────────────────────────────────────────────────────────────────

# Basename of input.program so /usr/bin/find matches "find".
program_base := parts[count(parts) - 1] if {
    parts := split(input.program, "/")
    count(parts) > 0
}

# Home directory from TS-side env signal (os.homedir). Undefined if unavailable.
home_dir := h if {
    h := object.get(object.get(object.get(input, "signals", {}), "env", {}), "home", "")
    is_string(h)
    h != ""
}

# Process cwd from TS-side env signal (repo/cwd allow-class).
eval_cwd := c if {
    c := object.get(object.get(object.get(input, "signals", {}), "env", {}), "cwd", "")
    is_string(c)
    c != ""
}

# Non-flag find path arguments (find roots).
find_path_args(args) := [t | some t in args; not startswith(t, "-")]

# Numeric -maxdepth N from args. Undefined when the flag is absent.
find_maxdepth := to_number(input.args[i + 1]) if {
    some i
    input.args[i] == "-maxdepth"
    count(input.args) > i + 1
}

# Path is under $HOME / /home/<user> / ~  (PREFIX, not exact root).
# Trailing slash, $HOME, ${HOME}, /home, /home/<user>/… all match.
is_home_prefix(p) if { p == "~" }
is_home_prefix(p) if { startswith(p, "~/") }
is_home_prefix(p) if { p == "$HOME" }
is_home_prefix(p) if { p == "${HOME}" }
is_home_prefix(p) if { startswith(p, "$HOME/") }
is_home_prefix(p) if { startswith(p, "${HOME}/") }
is_home_prefix(p) if { p == "/home" }
is_home_prefix(p) if { p == "/home/" }
is_home_prefix(p) if { regex.match("^/home/[^/]+(/.*)?$", p) }
is_home_prefix(p) if {
    home_dir != ""
    p == home_dir
}
is_home_prefix(p) if {
    home_dir != ""
    startswith(p, sprintf("%s/", [home_dir]))
}

# Known goal-dir prefixes that MUST stay allowed without a key.
# Every spelling requires a path boundary (`/` or end) so a sibling like
# `~/.pi/goals-evil` is NOT exempted (cubic P1 on safety.rego:931).
known_goal_prefix(p) if { p == "~/.pi/goals" }
known_goal_prefix(p) if { startswith(p, "~/.pi/goals/") }
known_goal_prefix(p) if { p == "~/.verifier-loop/goals" }
known_goal_prefix(p) if { startswith(p, "~/.verifier-loop/goals/") }
known_goal_prefix(p) if { regex.match("^/home/[^/]+/\\.pi/goals(/|$)", p) }
known_goal_prefix(p) if { regex.match("^/home/[^/]+/\\.verifier-loop/goals(/|$)", p) }
known_goal_prefix(p) if { regex.match("\\$HOME/\\.pi/goals(/|$)", p) }
known_goal_prefix(p) if { regex.match("\\$HOME/\\.verifier-loop/goals(/|$)", p) }
known_goal_prefix(p) if {
    home_dir != ""
    p == sprintf("%s/.pi/goals", [home_dir])
}
known_goal_prefix(p) if {
    home_dir != ""
    startswith(p, sprintf("%s/.pi/goals/", [home_dir]))
}
known_goal_prefix(p) if {
    home_dir != ""
    p == sprintf("%s/.verifier-loop/goals", [home_dir])
}
known_goal_prefix(p) if {
    home_dir != ""
    startswith(p, sprintf("%s/.verifier-loop/goals/", [home_dir]))
}

# A `..` segment escapes the goal dir (`~/.pi/goals/../../.ssh`) — reject it
# so the goal-dir allowlist cannot be used to traverse out (cubic P1:937).
has_dotdot_segment(p) if { regex.match("(^|/)\\.\\.(/|$)", p) }

# The allow-class exemption: a known-goal prefix WITHOUT any `..` segment.
is_known_goal_dir(p) if {
    known_goal_prefix(p)
    not has_dotdot_segment(p)
}

# Empty path args (shell-quote expanded `$HOME` → "") are NOT allow-class.
# Relative names (beet-orches) stay allowed.
is_cwd_or_relative(p) if { p == "." }
is_cwd_or_relative(p) if { p == "./" }
is_cwd_or_relative(p) if { startswith(p, "./") }
is_cwd_or_relative(p) if {
    p != ""
    not startswith(p, "/")
    not startswith(p, "~")
    not startswith(p, "$")
}

# Path is under the eval cwd (absolute repo path even when the repo lives
# under $HOME — `find <repo>` is the allow class).
is_under_eval_cwd(p) if {
    eval_cwd != ""
    p == eval_cwd
}
is_under_eval_cwd(p) if {
    eval_cwd != ""
    startswith(p, sprintf("%s/", [eval_cwd]))
}

# .worktrees prefix (repo-relative or absolute under cwd).
# The unscoped `/.worktrees` match was removed — a `.worktrees` anywhere on disk
# must NOT read as the allowlisted worktree tree (cubic P1 on safety.rego:974).
is_worktrees_path(p) if { p == ".worktrees" }
is_worktrees_path(p) if { startswith(p, ".worktrees/") }
is_worktrees_path(p) if { p == "./.worktrees" }
is_worktrees_path(p) if { startswith(p, "./.worktrees/") }
is_worktrees_path(p) if {
    eval_cwd != ""
    p == sprintf("%s/.worktrees", [eval_cwd])
}
is_worktrees_path(p) if {
    eval_cwd != ""
    startswith(p, sprintf("%s/.worktrees/", [eval_cwd]))
}

# maxdepth<=2 under .worktrees is the named allow-class exception.
# Missing -maxdepth, or N > 2, is a deny (the gate is real, not docs).
worktrees_maxdepth_ok if {
    find_maxdepth <= 2
    find_maxdepth >= 0
}

# Empty path args (shell-quote expanded `$HOME` → "") are the deny class.
find_path_is_denied(p) if { p == "" }

# A find path is denied when it is home-wide AND not in the allow class.
find_path_is_denied(p) if {
    is_home_prefix(p)
    not is_known_goal_dir(p)
    not is_under_eval_cwd(p)
    not is_worktrees_path(p)
}

# .worktrees walks: deny unless -maxdepth is present AND <= 2.
find_path_is_denied(p) if {
    is_worktrees_path(p)
    not worktrees_maxdepth_ok
}

# Raw-token fallback: `$HOME` / `"$HOME"` vanish from args (shell-quote
# expands them to empty). Same pattern as rm_raw_dangerous_token.
# Also matches `$HOME/…` / `~/…` prefix spellings (BHD-202 subtree cases).
find_raw_home_token(raw) if { regex.match("(^|\\s)\\$HOME(/|\\s|$)", raw) }
find_raw_home_token(raw) if { regex.match("(^|\\s)\"\\$HOME\"(/|\\s|$)", raw) }
find_raw_home_token(raw) if { regex.match("(^|\\s)'\\$HOME'(/|\\s|$)", raw) }
find_raw_home_token(raw) if { regex.match("(^|\\s)~(/|\\s|$)", raw) }

# Raw-based deny: $HOME / ~ token present; args lost the expansion.
# Exempt known goal dirs. Exempt `$HOME/<repo>` is handled via args + cwd.
# Every goal spelling requires a path boundary so a sibling scan like
# `find ~/.pi/goals-evil` is NOT exempted (cubic P1 on safety.rego:934).
find_raw_known_goal(raw) if { regex.match("\\$HOME/\\.pi/goals(/|$)", raw) }
find_raw_known_goal(raw) if { regex.match("\\$HOME/\\.verifier-loop/goals(/|$)", raw) }
find_raw_known_goal(raw) if { regex.match("~/.pi/goals(/|$)", raw) }
find_raw_known_goal(raw) if { regex.match("~/.verifier-loop/goals(/|$)", raw) }

# Args-based deny: any find path is a home-wide prefix outside the allow class.
deny[msg] if {
    program_base == "find"
    some p in find_path_args(input.args)
    find_path_is_denied(p)
    msg := "Home-wide find ($HOME/**, /home/<user>/**, ~/**) is blocked. Scope to cwd, a repo, or a known goal dir. .worktrees walks require -maxdepth 2. Unlock with block-home-wide-find."
}

deny[msg] if {
    program_base == "find"
    find_raw_home_token(input.raw)
    not find_raw_known_goal(input.raw)
    # If args still carry a path, let the args rule decide (cwd/repo allow).
    # Fire raw-token deny only when no surviving path arg is allow-class.
    not find_has_allow_class_path
    msg := "Home-wide find ($HOME/**, /home/<user>/**, ~/**) is blocked. Scope to cwd, a repo, or a known goal dir. .worktrees walks require -maxdepth 2. Unlock with block-home-wide-find."
}

# True when at least one find path is known-goal / cwd / repo (so a raw
# `$HOME` token that also appears inside an allowed path does not deny).
find_has_allow_class_path if {
    some p in find_path_args(input.args)
    is_known_goal_dir(p)
}
find_has_allow_class_path if {
    some p in find_path_args(input.args)
    is_under_eval_cwd(p)
    not is_worktrees_path(p)
}
find_has_allow_class_path if {
    some p in find_path_args(input.args)
    is_worktrees_path(p)
    worktrees_maxdepth_ok
}
find_has_allow_class_path if {
    some p in find_path_args(input.args)
    is_cwd_or_relative(p)
    not is_worktrees_path(p)
    not is_home_prefix(p)
}

# Recursive grep flag: -r / -R / --recursive / combined short cluster
# containing r/R (e.g. -rl, -ri). Same cluster pattern as rm_has_recursive.
grep_is_recursive(args) if { has_any_arg(args, ["-r", "-R", "--recursive"]) }
grep_is_recursive(args) if {
    some a in args
    startswith(a, "-")
    not startswith(a, "--")
    count(a) > 2
    contains(a, "r")
}
grep_is_recursive(args) if {
    some a in args
    startswith(a, "-")
    not startswith(a, "--")
    count(a) > 2
    contains(a, "R")
}

# Path looks like ~/.hermes (tilde, expanded, or /home/<user>/.hermes).
is_hermes_path(p) if { startswith(p, "~/.hermes") }
is_hermes_path(p) if { regex.match("^/home/[^/]+/\\.hermes", p) }
is_hermes_path(p) if {
    home_dir != ""
    startswith(p, sprintf("%s/.hermes", [home_dir]))
}

# Raw fallback for hermes path (when glob meta drops --include=*.db but
# the ~/.hermes token still sits in raw).
grep_raw_hermes(raw) if { regex.match("~/?\\.hermes", raw) }
grep_raw_hermes(raw) if { regex.match("/home/[^/ ]+/\\.hermes", raw) }
grep_raw_hermes(raw) if {
    home_dir != ""
    contains(raw, sprintf("%s/.hermes", [home_dir]))
}

deny[msg] if {
    program_base == "grep"
    grep_is_recursive(input.args)
    some p in input.args
    is_hermes_path(p)
    msg := "Recursive grep of ~/.hermes (including *.db) is blocked. Scope to cwd or a file. Unlock with block-home-wide-grep."
}

deny[msg] if {
    program_base == "grep"
    grep_is_recursive(input.args)
    grep_raw_hermes(input.raw)
    msg := "Recursive grep of ~/.hermes (including *.db) is blocked. Scope to cwd or a file. Unlock with block-home-wide-grep."
}

# ──────────────────────────────────────────────────────────────────
# GROUP L — shallow heavy scan (ban-shallow-heavy-scan / BHD-209)
# Deny class: heavy recursive scan program targeting a shallow path
#             (depth <= 2: / , /x , /x/y , ~ , ~/ , $HOME , "" from
#             $HOME expansion). Depth >= 3 allowed (LD4: du at depth
#             3). eza exempt ONLY when bounded by -L/--level (LD2
#             discovery step). Reuse GROUP K allow class (known-goal,
#             under eval_cwd, cwd-relative).
# ──────────────────────────────────────────────────────────────────

# Always-heavy scan programs — recursive by default, no flag gate
# (rg/fd/rgrep are recursive-by-default; gotcha G5.2). fsck/baobab from
# the turn-2 LD3 enumeration (full-device / full-tree scanners present
# on this machine: /usr/sbin/fsck, /usr/bin/baobab).
scan_programs := {"find", "du", "rg", "fd", "rgrep", "fsck", "baobab"}

# GROUP K already denies home-WIDE find. For find, defer home-prefix
# shallow paths to GROUP K so the agent sees ONE rule, not two (G4.8).
# grep/egrep are NOT deferred — GROUP K grep only gates ~/.hermes.
groupk_programs := {"find"}

# ls is heavy only with -R/--recursive.
ls_recursive(args) if { has_any_arg(args, ["-R", "--recursive"]) }

# eza recurses via -T/-R/--tree/--recurse; bounded ONLY by -L/--level
# with N <= 2 (gotcha eza-level-gate: `-L 99` is unbounded in practice,
# the exemption is real only when the level is a discovery bound).
eza_tree_flag(args) if { has_any_arg(args, ["-T", "--tree", "-R", "--recurse"]) }

eza_level_eq(args) := {n |
    some a in args
    startswith(a, "--level=")
    s := trim_prefix(a, "--level=")
    regex.match("^[0-9]+$", s)
    n := to_number(s)
}
eza_level_attached(args) := {n |
    some a in args
    regex.match("^-L=?[0-9]+$", a)
    s := trim_prefix(trim_prefix(a, "-L"), "=")
    n := to_number(s)
}
eza_level_separated(args) := {n |
    some i
    args[i] in {"-L", "--level"}
    count(args) > i + 1
    s := args[i + 1]
    regex.match("^[0-9]+$", s)
    n := to_number(s)
}

eza_level_bounded(args) if {
    ns := eza_level_eq(args) | eza_level_attached(args) | eza_level_separated(args)
    count(ns) > 0
    max(ns) <= 2
}

# A command is a heavy scan when:
#   - program is always-heavy, OR
#   - grep/egrep with a recursive flag, OR
#   - ls with -R/--recursive, OR
#   - eza with a tree flag and no level bound.
heavy_scan_program if { scan_programs[program_base] }
heavy_scan_program if {
    program_base == "grep"
    grep_is_recursive(input.args)
}
heavy_scan_program if {
    program_base == "egrep"
    grep_is_recursive(input.args)
}
heavy_scan_program if {
    program_base == "ls"
    ls_recursive(input.args)
}
heavy_scan_program if {
    program_base == "eza"
    eza_tree_flag(input.args)
    not eza_level_bounded(input.args)
}

# Path-programs: every non-flag arg is a path (find/du/ls/eza).
# Pattern-programs: first non-flag arg is the PATTERN (rg/fd/rgrep/
# grep/egrep) — drop it so pattern text like "/var" isn't a path (G4.6).
scan_path_programs := {"find", "du", "ls", "eza", "fsck", "baobab"}
scan_pattern_programs := {"rg", "fd", "rgrep", "grep", "egrep"}

scan_path_args(program) := paths if {
    scan_path_programs[program]
    paths := [t | some t in input.args; not startswith(t, "-")]
}
scan_path_args(program) := paths if {
    scan_pattern_programs[program]
    nonflag := [t | some t in input.args; not startswith(t, "-")]
    paths := array.slice(nonflag, 1, count(nonflag))
}

# Depth of an absolute path after normalizing '.' (skip) and '..' (pop).
# Empty segments (from '//' and trailing '/') dropped by the comprehension.
# Non-recursive: depth = count(normal segments) - count('..' segments).
# Correct for absolute paths (no leading '..'); over-blocks on rare
# leading-'..' spellings (safe direction).
path_depth(p) := result if {
    segs := [s | some s in split(p, "/"); s != ""]
    norm := [s | some s in segs; s != "."; s != ".."]
    dds := [s | some s in segs; s == ".."]
    result := count(norm) - count(dds)
}

# Shallow target: home-root spellings (empty arg from $HOME expansion,
# ~ , ~/ , $HOME , ${HOME}) OR an absolute path resolving to depth <= 2.
shallow_target(p) if { p == "" }
shallow_target(p) if { p == "~" }
shallow_target(p) if { p == "~/" }
shallow_target(p) if { p == "$HOME" }
shallow_target(p) if { p == "${HOME}" }
shallow_target(p) if {
    startswith(p, "/")
    path_depth(p) <= 2
}

# GROUP K home-wide find deferral (see groupk_programs above).
groupk_home_deferral(p) if {
    groupk_programs[program_base]
    is_home_prefix(p)
}

# A shallow path is denied unless allow-class or GROUP K defers it.
shallow_path_is_denied(p) if {
    shallow_target(p)
    not is_known_goal_dir(p)
    not is_under_eval_cwd(p)
    not is_cwd_or_relative(p)
    not groupk_home_deferral(p)
}

# OT7 (resolved 2026-09-13): only DESCENT-PRUNING caps earn the
# exemption — `find -maxdepth N` and `rg --max-depth N` stop walking
# deeper than N (genuinely bounded at N <= 2). `du -d N` does NOT prune
# (du still stats the ENTIRE tree; -d only bounds printing) → du never
# exempt — the turn-1 incident was exactly `du -xh -d1 /` hanging 300s.
maxdepth_separated(args, flag) := {n |
    some i
    args[i] == flag
    count(args) > i + 1
    s := args[i + 1]
    regex.match("^[0-9]+$", s)
    n := to_number(s)
}
maxdepth_inline(args, flag) := {n |
    some a in args
    startswith(a, sprintf("%s=", [flag]))
    s := trim_prefix(a, sprintf("%s=", [flag]))
    regex.match("^[0-9]+$", s)
    n := to_number(s)
}
maxdepth_values(args, flag) := maxdepth_separated(args, flag) | maxdepth_inline(args, flag)

depth_cap_bounded if {
    program_base == "find"
    ns := maxdepth_values(input.args, "-maxdepth")
    count(ns) > 0
    max(ns) <= 2
}
depth_cap_bounded if {
    program_base == "rg"
    ns := maxdepth_values(input.args, "--max-depth") | maxdepth_values(input.args, "--maxdepth")
    count(ns) > 0
    max(ns) <= 2
}

# Args-based deny: heavy scan program with a denied shallow path arg.
deny[msg] if {
    heavy_scan_program
    not depth_cap_bounded
    some p in scan_path_args(program_base)
    shallow_path_is_denied(p)
    msg := "Recursive scan (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is blocked — full-tree IO saturates the disk and hangs. Discover first with `eza -T -L 2 <dir>`, then scan a specific ≥3-level target (e.g. `/var/lib/docker`, `/home/bhd/.local`). Unlock: `block-shallow-heavy-scan`."
}

# Raw-token deny: heavy scan program with a bare home-root token whose
# arg was expanded away (quoted "$HOME" etc). Tilde/path spellings are
# skipped — only the bare home root (~, $HOME) is shallow (depth 2).
scan_raw_shallow_token(raw) if { regex.match("(^|\\s)~(\\s|$)", raw) }
scan_raw_shallow_token(raw) if { regex.match("(^|\\s)\\$HOME(\\s|$)", raw) }
scan_raw_shallow_token(raw) if { regex.match("(^|\\s)\"\\$HOME\"(\\s|$)", raw) }
scan_raw_shallow_token(raw) if { regex.match("(^|\\s)'\\$HOME'(\\s|$)", raw) }
scan_raw_shallow_token(raw) if { regex.match("(^|\\s)\\$\\{HOME\\}(\\s|$)", raw) }

deny[msg] if {
    heavy_scan_program
    not groupk_programs[program_base]
    not depth_cap_bounded
    scan_raw_shallow_token(input.raw)
    msg := "Recursive scan (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is blocked — full-tree IO saturates the disk and hangs. Discover first with `eza -T -L 2 <dir>`, then scan a specific ≥3-level target (e.g. `/var/lib/docker`, `/home/bhd/.local`). Unlock: `block-shallow-heavy-scan`."
}

# ──────────────────────────────────────────────────────────────────
# USAGE
# ──────────────────────────────────────────────────────────────────
# After your parser normalizes a raw command into the input struct:
#
#   opa eval -d safety.rego -i input.json 'data.safety.allow'
#
# input.json example:
#   {"program":"git","subcommand":"stash","args":["list"],"raw":"git stash list"}
#   → true  (allowed — list is carve-out)
#
#   {"program":"git","subcommand":"stash","args":["pop"],"raw":"git stash pop"}
#   → false (denied)
#
#   {"program":"git","subcommand":"","args":[],"raw":"git stash"}
#   → false (denied — bare-default handled natively; [OT3] resolved in OPA)
