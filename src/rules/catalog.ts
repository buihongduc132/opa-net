import type { RuleMeta } from './RuleRegistry.ts';

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
];

/** gcloud/bq produce sprintf messages — family inferred from program. */
export function inferFamilyFromProgram(program: string): 'gcloud' | 'bq' | 'custom' {
  switch (program) {
    case 'gcloud':
      return 'gcloud';
    case 'bq':
      return 'bq';
    default:
      return 'custom';
  }
}
