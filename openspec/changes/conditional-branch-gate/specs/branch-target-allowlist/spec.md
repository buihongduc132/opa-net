## ADDED Requirements

### Requirement: Branch-target-allowlist rule denies checkout/switch to non-allowlisted branches
The system SHALL deny `git checkout` and `git switch` commands that target a local branch ref when the target branch is NOT in the configured `PIOPANET_ALLOWED_BRANCHES` set AND the command is issued from the main worktree. The rule SHALL be inert in linked (sub-)worktrees.

#### Scenario: Checkout to a non-allowed branch from main worktree is denied
- **WHEN** the command is `git checkout feature-xyz` evaluated in the main worktree
- **AND** `PIOPANET_ALLOWED_BRANCHES` is not set (defaults to `dev,staging,main,master`)
- **THEN** the decision is `deny` with reason `branch-target-allowlist: non-allowed-branch`
- **AND** the decision record contains `signals.git.target_branch = "feature-xyz"` and `signals.repo.is_main_worktree = true`

#### Scenario: Switch to an allowed branch from main worktree is allowed
- **WHEN** the command is `git switch dev` evaluated in the main worktree
- **AND** `PIOPANET_ALLOWED_BRANCHES` is not set
- **THEN** the decision is `allow`
- **AND** the branch-target-allowlist rule is not triggered

#### Scenario: Checkout to a non-allowed branch from a sub-worktree is allowed
- **WHEN** the command is `git checkout feature-xyz` evaluated in a linked worktree (created via `git worktree add`)
- **AND** `PIOPANET_ALLOWED_BRANCHES` is not set
- **THEN** the decision is `allow`
- **AND** the decision record contains `signals.repo.is_main_worktree = false`

#### Scenario: Custom allowed branches respected
- **WHEN** `PIOPANET_ALLOWED_BRANCHES` is set to `trunk,develop`
- **AND** the command is `git checkout trunk` evaluated in the main worktree
- **THEN** the decision is `allow`
- **AND** when the command is `git checkout main` evaluated in the main worktree
- **THEN** the decision is `deny`

#### Scenario: Empty allowed-branch list disables the rule
- **WHEN** `PIOPANET_ALLOWED_BRANCHES` is set to `""`
- **AND** the command is `git checkout anything` evaluated in the main worktree
- **THEN** the decision is `allow`
- **AND** the branch-target-allowlist rule is not triggered

#### Scenario: Checkout of a commit-ish is not a branch switch
- **WHEN** the command is `git checkout abc1234` evaluated in the main worktree
- **AND** `abc1234` does not resolve as a local branch ref (`git rev-parse --verify refs/heads/abc1234` fails)
- **THEN** the decision is `allow`
- **AND** the branch-target-allowlist rule is not triggered

#### Scenario: Checkout with file restore is not a branch switch
- **WHEN** the command is `git checkout feature -- src/app.ts` evaluated in the main worktree
- **AND** the parser detects the `--` separator (pathspec form)
- **THEN** the decision is `allow`
- **AND** the branch-target-allowlist rule is not triggered

#### Scenario: Detached-HEAD intent is not a branch switch
- **WHEN** the command is `git checkout --detach abc1234` evaluated in the main worktree
- **THEN** the decision is `allow`
- **AND** the branch-target-allowlist rule is not triggered

#### Scenario: Remote-tracking branch reference is normalized
- **WHEN** the command is `git checkout origin/feature` evaluated in the main worktree
- **AND** the parser strips the `origin/` prefix and resolves `feature` as the target
- **THEN** if `feature` is a local branch ref, the rule evaluates against `feature`
- **AND** if `feature` is NOT a local branch ref, the decision is `allow`

### Requirement: Branch-target-allowlist is fail-open on missing signals
The system SHALL evaluate the branch-target-allowlist rule only when `input.signals.git.available` is `true`, `input.signals.repo.available` is `true`, and `input.signals.repo.is_main_worktree` is `true`. In all other cases the rule SHALL be inert.

#### Scenario: Non-repo cwd
- **WHEN** the evaluated command is `git checkout feature` in a directory that is not a git repository
- **THEN** the decision is `allow` (the remaining policy still applies; branch-target-allowlist does not fire)

#### Scenario: Sub-worktree cwd
- **WHEN** the evaluated command is `git checkout feature` in a linked worktree
- **THEN** the decision is `allow`
- **AND** the decision record contains `signals.repo.is_main_worktree = false`

### Requirement: Git global options are stripped before subcommand classification
The system SHALL strip git global options (e.g. `-C <path>`, `--git-dir=<path>`, `--work-tree=<path>`) from the parsed args before classifying the subcommand, so that `git -C /evil worktree add foo` is correctly classified as `subcommand="worktree"`.

#### Scenario: git -C path worktree add
- **WHEN** the command is `git -C /evil worktree add foo`
- **THEN** the parsed struct has `subcommand="worktree"` (not `""`)
- **AND** the parsed struct has `args=["add", "foo"]` (not `["-C", "/evil", "worktree", "add", "foo"]`)

#### Scenario: git --git-dir=path status
- **WHEN** the command is `git --git-dir=/tmp/x status`
- **THEN** the parsed struct has `subcommand="status"`

#### Scenario: Multiple global options in sequence
- **WHEN** the command is `git -C /a -c user.email=x@y.com commit -m foo`
- **THEN** the parsed struct has `subcommand="commit"` and `args=["-m", "foo"]`

### Requirement: Checkout/switch target is classified unambiguously
The system SHALL classify the target of a `git checkout`/`git switch` command via `git rev-parse --verify refs/heads/<X>`, detecting the `--` separator as a pathspec indicator and handling `--detach`/`-d` and `-` (previous-branch) tokens correctly.

#### Scenario: Bare branch
- **WHEN** the command is `git checkout feature` and `feature` resolves as a local branch ref
- **THEN** the parsed target is `{ kind: 'branch', name: 'feature' }`

#### Scenario: File restore
- **WHEN** the command is `git checkout -- src/app.ts`
- **THEN** the parsed target is `{ kind: 'file-restore' }` and branch rules are not triggered

#### Scenario: Commit-ish
- **WHEN** the command is `git checkout abc1234` and `abc1234` does NOT resolve as a local branch ref
- **THEN** the parsed target is `{ kind: 'commit-ish' }` and branch rules are not triggered

#### Scenario: Remote-tracking reference normalized
- **WHEN** the command is `git checkout origin/feature` and `origin/feature` is a remote-tracking ref but `feature` is a local branch ref
- **THEN** the parsed target is `{ kind: 'branch', name: 'feature' }` (remote prefix stripped)

## MODIFIED Requirements

_(none — this is a new capability for the project.)_

## REMOVED Requirements

_(none — this is a new capability for the project.)_
