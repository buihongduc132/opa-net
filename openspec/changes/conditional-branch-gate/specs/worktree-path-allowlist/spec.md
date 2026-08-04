## ADDED Requirements

### Requirement: Worktree-path-allowlist rule denies git worktree add outside allowed dirs
The system SHALL deny `git worktree add <path>` commands when the canonicalized target path is NOT under any of the configured `PIOPANET_WORKTREE_ALLOWED_DIRS` prefixes. The rule SHALL also apply to `git worktree move <wt> <new-path>` and `git worktree repair <path>` (OT15).

#### Scenario: git worktree add to /tmp/evil is denied
- **WHEN** the command is `git worktree add /tmp/evil`
- **AND** `PIOPANET_WORKTREE_ALLOWED_DIRS` is not set (defaults to `.worktrees,worktrees,~/.config/superpowers/worktrees`)
- **THEN** the decision is `deny` with reason `worktree-path-allowlist: path-outside-allowed`

#### Scenario: git worktree add to .worktrees/feat is allowed
- **WHEN** the command is `git worktree add .worktrees/feat`
- **AND** the canonicalized path resolves under the project's `.worktrees/` directory
- **THEN** the decision is `allow`

#### Scenario: git worktree move evades add-only rule
- **WHEN** the command is `git worktree move .worktrees/feat /tmp/evil`
- **THEN** the decision is `deny` with reason `worktree-path-allowlist: path-outside-allowed`
- **AND** the canonicalized new-path `/tmp/evil` is checked against allowed prefixes

#### Scenario: git worktree repair with disallowed path
- **WHEN** the command is `git worktree repair /tmp/evil`
- **THEN** the decision is `deny` with reason `worktree-path-allowlist: path-outside-allowed`

#### Scenario: Symlink escape is denied
- **WHEN** the command is `git worktree add .worktrees/evil`
- **AND** `.worktrees/evil` is a symlink pointing to `/tmp/evil`
- **THEN** the decision is `deny` (realpath resolves to `/tmp/evil` which is not under allowed prefixes)

#### Scenario: Path traversal is denied
- **WHEN** the command is `git worktree add .worktrees/../../evil`
- **THEN** the decision is `deny` (realpath resolves outside allowed prefixes)

#### Scenario: .git-named target is denied
- **WHEN** the command is `git worktree add .worktrees/.git`
- **THEN** the decision is `deny` (basename `.git` is always rejected)

#### Scenario: Custom allowed dirs respected
- **WHEN** `PIOPANET_WORKTREE_ALLOWED_DIRS` is set to `/opt/worktrees,/tmp/safe`
- **AND** the command is `git worktree add /opt/worktrees/feat`
- **THEN** the decision is `allow`

#### Scenario: Empty allowed-dirs list disables the rule
- **WHEN** `PIOPANET_WORKTREE_ALLOWED_DIRS` is set to `""`
- **AND** the command is `git worktree add /tmp/anything`
- **THEN** the decision is `allow`
- **AND** the worktree-path-allowlist rule is not triggered

### Requirement: Path canonicalization is mandatory before prefix match
The system SHALL run `fs.realpathSync()` on both the target path AND every allowed-prefix BEFORE passing them to Rego. The system SHALL reject if realpath fails, if the resolved path contains `..` segments, or if the target basename is `.git`. The Rego prefix match SHALL use `startswith(resolved, allowed + path.sep)` to enforce boundary.

#### Scenario: Boundary enforcement
- **WHEN** the allowed prefix is `/opt/worktrees`
- **AND** the target path resolves to `/opt/worktrees-evil/feat`
- **THEN** the decision is `deny` (boundary-enforced: `startswith('/opt/worktrees-evil/feat', '/opt/worktrees/')` is false)

#### Scenario: realpath failure rejects the target
- **WHEN** the target path does not exist and cannot be resolved
- **THEN** the decision is `deny` with reason `worktree-path-allowlist: realpath-failed`

### Requirement: Worktree-path-allowlist is scoped to git worktree only
The system SHALL only apply the worktree-path-allowlist rule to `git worktree` subcommands. `gh repo clone`, `git clone`, and other commands that create directories are NOT gated by this rule.

#### Scenario: gh repo clone is not gated
- **WHEN** the command is `gh repo clone user/repo /tmp/evil`
- **THEN** the worktree-path-allowlist rule is not triggered

#### Scenario: git clone is not gated
- **WHEN** the command is `git clone https://example.com/repo.git /tmp/evil`
- **THEN** the worktree-path-allowlist rule is not triggered

### Requirement: Worktree-path-allowlist is fail-open on missing signals
The system SHALL evaluate the worktree-path-allowlist rule only when the worktree signal is available and the target path can be extracted. In all other cases the rule SHALL be inert.

#### Scenario: Non-git command
- **WHEN** the evaluated command is `docker run -v /tmp/evil:/data image`
- **THEN** the worktree-path-allowlist rule is not triggered

## MODIFIED Requirements

_(none — this is a new capability for the project.)_

## REMOVED Requirements

_(none — this is a new capability for the project.)_
