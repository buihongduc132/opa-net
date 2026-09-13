import type { RuleFamily, RuleMeta } from './RuleRegistry.ts';

/**
 * Canonical rule catalog — mirrors policy/safety.rego message-for-message.
 *
 * Single source of truth for rule_id + family + suggestions. When you add a
 * deny rule to safety.rego, add its message here too. The registry test
 * (`rule-catalog-parity.test.ts`) fails if the rego and this list drift.
 */
export const RULES: readonly RuleMeta[] = [
  // ── GROUP A: git ──
  {
    ruleId: 'block-git-commit-am',
    family: 'git',
    message:
      'git commit -am stages ALL tracked modifications indiscriminately. Use explicit paths.',
    suggestions: ['git commit -m "msg" <paths>'],
  },
  {
    ruleId: 'block-git-commit-no-verify',
    family: 'git',
    message: 'ALWAYS run pre-commit hooks. Bypassing hooks risks shipping broken changes.',
  },
  {
    ruleId: 'block-git-stash-mutations',
    family: 'git',
    message: 'Do not mutate stashes in shared work. Others may be relying on them.',
    suggestions: ['git stash list', 'git stash show'],
  },
  {
    ruleId: 'builtin:bare-stash-default',
    family: 'builtin',
    message: 'Bare `git stash` defaults to push. Use `git stash list/show` explicitly.',
    suggestions: ['git stash list', 'git stash show', 'git stash branch <name>'],
  },
  {
    ruleId: 'block-git-reset-hard',
    family: 'git',
    message: "Hard reset discards local work and can remove others' uncommitted changes.",
  },
  {
    ruleId: 'block-git-reset-mixed',
    family: 'git',
    message: 'Mixed reset rewrites index state and can disrupt shared work.',
  },
  {
    ruleId: 'block-git-reset-modes',
    family: 'git',
    message: 'Reset modes can unexpectedly alter local changes in shared work.',
  },
  {
    ruleId: 'block-git-clean-force',
    family: 'git',
    message: 'git clean can permanently remove untracked files from the working tree.',
  },
  {
    ruleId: 'block-git-checkout-discard',
    family: 'git',
    message: "checkout -- discards local file changes and may destroy others' work.",
  },
  {
    ruleId: 'block-git-checkout-B',
    family: 'git',
    message: 'git checkout -B force-resets branch refs and can trash shared branches.',
  },
  {
    ruleId: 'block-git-restore',
    family: 'git',
    message: 'git restore can discard tracked modifications in shared work.',
  },
  {
    ruleId: 'block-git-add-all',
    family: 'git',
    message: 'git add -A / -a stages ALL changed files indiscriminately. Use explicit paths.',
    suggestions: ['git add <explicit-paths>'],
  },
  {
    ruleId: 'block-git-add-dot',
    family: 'git',
    message: 'git add . stages ALL files in the current directory indiscriminately.',
    suggestions: ['git add <explicit-paths>'],
  },
  {
    ruleId: 'block-git-switch-C',
    family: 'git',
    message: 'git switch -C force-resets branch refs and can rewrite shared history.',
  },
  {
    ruleId: 'block-git-branch-force',
    family: 'git',
    message: 'Forced branch moves or renames can rewrite refs and disrupt shared work.',
  },
  {
    ruleId: 'block-git-rebase',
    family: 'git',
    message: 'Rebase rewrites commit history and is blocked in this environment.',
  },
  {
    ruleId: 'block-git-rebase-lifecycle',
    family: 'git',
    message: 'git rebase --continue/--skip/--abort should be run only with explicit approval.',
  },
  // ── GROUP B: docker subcommands ──
  {
    ruleId: 'block-docker-stop',
    family: 'docker',
    message: 'Direct container stop is blocked to protect services managed by Nomad.',
  },
  {
    ruleId: 'block-docker-kill',
    family: 'docker',
    message: 'Direct container kill is blocked. Abrupt termination risks data loss.',
  },
  {
    ruleId: 'block-docker-rm',
    family: 'docker',
    message: 'Direct container removal is blocked. Re-deploying via Nomad is safer.',
  },
  {
    ruleId: 'block-docker-restart',
    family: 'docker',
    message: 'NEVER restart containers directly. This bypasses scheduling safety.',
  },
  {
    ruleId: 'block-docker-exec',
    family: 'docker',
    message: 'Direct exec into containers is blocked for security.',
  },
  {
    ruleId: 'block-docker-update',
    family: 'docker',
    message: 'Direct resource updates are blocked. Use Nomad job specification.',
  },
  {
    ruleId: 'block-docker-rename',
    family: 'docker',
    message: 'Container renaming is blocked to prevent breaking service discovery.',
  },
  {
    ruleId: 'block-docker-volume-rm-prune',
    family: 'docker',
    message: 'Direct volume removal is strictly blocked to prevent data loss.',
  },
  {
    ruleId: 'block-docker-volume-create',
    family: 'docker',
    message: 'Manual volume creation is blocked to maintain infra-as-code parity.',
  },
  // ── GROUP C: docker compose carve-outs ──
  {
    ruleId: 'block-docker-compose-down-litellm',
    family: 'docker',
    message: 'NEVER bring down litellm/litellm-local/omniroute via docker compose.',
  },
  {
    ruleId: 'block-docker-compose-rm-litellm',
    family: 'docker',
    message: 'NEVER remove litellm/litellm-local/omniroute containers via docker compose.',
  },
  {
    ruleId: 'block-docker-compose-target-litellm',
    family: 'docker',
    message: 'NEVER stop litellm/litellm-local/omniroute via docker compose --target.',
  },
  // ── GROUP D: command-level ──
  {
    ruleId: 'block-bd-notes',
    family: 'bd',
    message: 'Use --append-notes instead to preserve existing notes.',
    suggestions: ['bd --append-notes'],
  },
  // ── GROUP E: rm ──
  {
    ruleId: 'block-rm-bd-sub-skills',
    family: 'rm',
    message: "Removing deprecated bd sub-skill directories is blocked (rule is misnamed 'allow').",
  },
  {
    ruleId: 'block-rm-beads-subdirs',
    family: 'rm',
    message: "Removing symlink subdirs in beads/ skill is blocked (rule is misnamed 'allow').",
  },
  {
    ruleId: 'block-rm-rf-dangerous-target',
    family: 'rm',
    message:
      'rm -rf on dangerous targets (/, ~, ., .., *, /*, $HOME, /home) is blocked. Use specific paths like /tmp/dir or ./subdir.',
  },
  // ── GROUP K: home-wide find/grep (BHD-165) ──
  {
    ruleId: 'block-home-wide-find',
    family: 'find',
    message:
      'Home-wide find ($HOME/**, /home/<user>/**, ~/**) is blocked. Scope to cwd, a repo, or a known goal dir. .worktrees walks require -maxdepth 2. Unlock with block-home-wide-find.',
    suggestions: [
      'find .',
      'find <repo>',
      'find ~/.pi/goals',
      'find ~/.verifier-loop/goals',
      'find <repo>/.worktrees -maxdepth 2',
    ],
  },
  {
    ruleId: 'block-home-wide-grep',
    family: 'grep',
    message:
      'Recursive grep of ~/.hermes (including *.db) is blocked. Scope to cwd or a file. Unlock with block-home-wide-grep.',
    suggestions: ['grep -r foo .', 'rg -l <pattern> .'],
  },
  // ── GROUP L: shallow heavy scan (BHD-209) ──
  {
    ruleId: 'block-shallow-heavy-scan',
    family: 'scan',
    message:
      'Recursive scan (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is blocked — full-tree IO saturates the disk and hangs. Discover first with `eza -T -L 2 <dir>`, then scan a specific ≥3-level target (e.g. `/var/lib/docker`, `/home/bhd/.local`). Unlock: `block-shallow-heavy-scan`.',
    suggestions: ['eza -T -L 2 <dir>', 'du -sh /var/lib/docker', 'du -sh /home/bhd/.local'],
  },
  // ── GROUP F: gh / glab ──
  {
    ruleId: 'block-gh-repo-delete-archive',
    family: 'gh',
    message: 'Destructive GitHub repository lifecycle actions are blocked by default.',
  },
  {
    ruleId: 'block-gh-repo-public',
    family: 'gh',
    message: 'Public GitHub repository creation is blocked by default.',
  },
  {
    ruleId: 'block-gh-repo-visibility',
    family: 'gh',
    message: 'GitHub repository visibility changes are blocked by default.',
  },
  {
    ruleId: 'block-glab-repo-delete-archive',
    family: 'glab',
    message: 'Destructive GitLab repository lifecycle actions are blocked by default.',
  },
  {
    ruleId: 'block-glab-repo-public',
    family: 'glab',
    message: 'Public GitLab repository creation is blocked by default.',
  },
  // ── GROUP G: tmux / pkill / killall session protection (cc-safety-net parity) ──
  {
    ruleId: 'block-tmux-kill-server',
    family: 'tmux',
    message:
      'Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically \u2014 hand the exact command back to the user and let them run it themselves.',
    matchArgs: ['kill-server'],
  },
  {
    ruleId: 'block-tmux-kill-session',
    family: 'tmux',
    message:
      'Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically \u2014 hand the exact command back to the user and let them run it themselves.',
    matchArgs: ['kill-session'],
  },
  {
    ruleId: 'block-pkill-tmux-wezterm',
    family: 'pkill',
    message:
      'Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically \u2014 hand the exact command back to the user and let them run it themselves.',
  },
  {
    ruleId: 'block-killall-tmux-wezterm',
    family: 'killall',
    message:
      'Killing the tmux/wezterm server destroys ALL sessions, panes, and in-flight work across every client. Do NOT run this automatically \u2014 hand the exact command back to the user and let them run it themselves.',
  },
  // ── GROUP H: herdr session protection ──
  {
    ruleId: 'block-herdr-server-stop',
    family: 'herdr',
    message:
      'Stopping the herdr server destroys all active workspaces, sessions, and agent state. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-herdr-session-stop',
    family: 'herdr',
    message:
      'Stopping a herdr session destroys in-flight agent work. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-herdr-session-delete',
    family: 'herdr',
    message:
      'Deleting a herdr session removes persisted state. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-herdr-workspace-close',
    family: 'herdr',
    message:
      'Closing a herdr workspace destroys active agent state. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  // ── GROUP I: pulumi IaC ──
  {
    ruleId: 'block-pulumi-up-force',
    family: 'pulumi',
    message:
      'pulumi up with --force/--yes/--skip-preview bypasses the deployment preview and applies changes without review. Run `pulumi preview` and apply only with explicit approval.',
    suggestions: ['pulumi preview', 'pulumi up'],
  },
  {
    ruleId: 'block-pulumi-destroy',
    family: 'pulumi',
    message:
      'pulumi destroy tears down ALL resources in the stack. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-pulumi-stack-rm',
    family: 'pulumi',
    message:
      'pulumi stack rm deletes the stack and its state. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-pulumi-state-delete',
    family: 'pulumi',
    message:
      'pulumi state delete/unprotect mutates stack state and can orphan or expose real infrastructure. Do NOT run this automatically.',
  },
  // ── GROUP J: DevOps destructive-CLI ──
  {
    ruleId: 'block-iac-destroy',
    family: 'iac',
    message:
      'terraform/tofu/terragrunt destroy tears down ALL resources managed by the stack. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-iac-apply-autoapprove',
    family: 'iac',
    message:
      'terraform/tofu/terragrunt apply -auto-approve bypasses the plan review prompt. Run `terraform plan` and apply only with explicit approval.',
    suggestions: ['terraform plan'],
  },
  {
    ruleId: 'block-iac-state-rm',
    family: 'iac',
    message:
      'terraform/tofu/terragrunt state rm/delete removes resources from state and can orphan real infrastructure. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-terragrunt-run-destroy',
    family: 'iac',
    message:
      'terragrunt run destroy applies a destroy plan across the module tree. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-terragrunt-run-apply-autoapprove',
    family: 'iac',
    message:
      'terragrunt run apply --auto-approve bypasses plan review across every module in the tree. Apply only with explicit approval.',
  },
  {
    ruleId: 'block-nomad-job-stop',
    family: 'nomad',
    message:
      'nomad job stop/deregister tears down scheduled work. Re-deploy via the Nomad job specification instead of manual stops.',
  },
  {
    ruleId: 'block-nomad-alloc-stop',
    family: 'nomad',
    message:
      'Direct alloc stop/signal/restart bypasses scheduler safety. Use deployment-level operations instead.',
  },
  {
    ruleId: 'block-nomad-system-gc',
    family: 'nomad',
    message:
      'nomad system gc force-garbage-collects the cluster and can disrupt running work. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-nomad-node-drain',
    family: 'nomad',
    message:
      'nomad node drain/eligibility evicts all allocations from a node. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-nomad-deployment-fail',
    family: 'nomad',
    message:
      'nomad deployment fail/pause aborts a rolling deployment mid-flight. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-nomad-volume-detach',
    family: 'nomad',
    message:
      'nomad volume detach detaches storage from running work. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-consul-kv-delete',
    family: 'consul',
    message:
      'consul kv delete removes cluster configuration state. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-consul-services-deregister',
    family: 'consul',
    message:
      'consul services deregister breaks service discovery for the node. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-consul-leave',
    family: 'consul',
    message:
      'consul leave/force-leave removes the agent from the cluster. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-consul-operator-remove-peer',
    family: 'consul',
    message:
      'consul operator raft remove-peer mutates Raft consensus membership. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-vault-kv-delete',
    family: 'vault',
    message:
      'vault kv delete/destroy removes secret data. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-vault-engine-disable',
    family: 'vault',
    message:
      'vault secrets/auth disable turns off a secrets engine or auth method. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-vault-revoke',
    family: 'vault',
    message: 'vault token/lease revoke invalidates credentials. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-vault-seal',
    family: 'vault',
    message:
      'vault seal makes the Vault sealed and unavailable. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-vault-operator-remove-peer',
    family: 'vault',
    message:
      'vault operator raft remove-peer mutates Raft consensus membership. Do NOT run this automatically.',
  },
  {
    ruleId: 'block-aws-destructive-verbs',
    family: 'aws',
    message:
      'Destructive AWS operation tokens (terminate/stop/delete class) are blocked by default. Use read-only describe/list/get operations.',
  },
  {
    ruleId: 'block-aws-s3-rm',
    family: 'aws',
    message:
      'aws s3 rm/rb deletes objects or buckets. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-pm2-kill',
    family: 'svcman',
    message:
      'pm2 kill/delete/stop/restart affects every managed node service. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-systemctl-stop',
    family: 'svcman',
    message:
      'systemctl stop/kill/mask/disable/isolate affects host services. Do NOT run this automatically \u2014 hand the exact command back to the user.',
  },
  {
    ruleId: 'block-dd-of-dev',
    family: 'dd',
    message:
      'dd writing to a raw block device (of=/dev/*) can destroy disks beyond recovery. Do NOT run this automatically.',
  },
];

/** gcloud/bq produce sprintf messages — family inferred from program.
 *  tmux/pkill/killall rules share identical reason text (the four session-kill
 *  rules), so their family is also inferred from the program to disambiguate
 *  the message-keyed registry. */
export function inferFamilyFromProgram(program: string): RuleFamily {
  switch (program) {
    case 'gcloud':
      return 'gcloud';
    case 'bq':
      return 'bq';
    case 'tmux':
      return 'tmux';
    case 'pkill':
      return 'pkill';
    case 'killall':
      return 'killall';
    case 'herdr':
      return 'herdr';
    case 'pulumi':
      return 'pulumi';
    case 'docker-compose':
      return 'docker';
    case 'find':
      return 'find';
    case 'grep':
      return 'grep';
    case 'du':
    case 'rg':
    case 'fd':
    case 'rgrep':
    case 'ls':
      return 'scan';
    default:
      return 'custom';
  }
}
