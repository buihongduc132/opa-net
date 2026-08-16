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
