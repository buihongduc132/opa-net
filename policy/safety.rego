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
#     signals: {                                  (conditional-branch-gate D3/D5)
#       git: {
#         available:      bool                     (false ⇒ rule skips, fail-open)
#         current_branch: string | null            (null in non-repo / missing git)
#         target_branch:  string | null            (parsed checkout/switch target)
#       }
#     }
#   }
#
# Branch-protection also consumes a data document passed via `-d data.json`:
#   data.config.protected_branches: ["main", "staging", ...]
# When no data document is supplied the rule sees an undefined set and never
# fires (the fail-open behavior for unprotected configs).
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
# GROUP G — branch-protection gate (conditional-branch-gate D3/D4)
# Deny checkout/switch OFF a protected branch to a DIFFERENT branch.
# Fails open (never fires) when:
#   - signals.git is absent (non-git command — `input.signals.git` is undefined)
#   - signals.git.available is false (non-repo / detached HEAD / missing git)
#   - current_branch is not in data.config.protected_branches
#   - target_branch is null, or equals current_branch
# Protected branches come from a data document (-d data.json) as
# data.config.protected_branches, so empty/undefined config ⇒ no match.
# ──────────────────────────────────────────────────────────────────

deny[msg] if {
    input.program == "git"
    input.subcommand in {"checkout", "switch"}
    input.signals.git.available
    input.signals.git.current_branch != null
    input.signals.git.target_branch != null
    input.signals.git.target_branch != input.signals.git.current_branch
    input.signals.git.current_branch in data.config.protected_branches
    msg := sprintf("branch-protection: %s off protected branch %s", [input.subcommand, input.signals.git.current_branch])
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
