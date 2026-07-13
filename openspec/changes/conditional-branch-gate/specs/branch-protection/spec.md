## ADDED Requirements

### Requirement: Branch-protection rule denies checkout/switch off protected branches
The system SHALL deny `git checkout` and `git switch` commands that switch away from a protected branch when the current branch is in the configured protected set and the target branch is a different branch.

#### Scenario: Checkout away from main is denied
- **WHEN** the current branch is `main` and the command is `git checkout feature`
- **THEN** the decision is `deny` with reason `branch-protection: checkout-off-protected`

#### Scenario: Switch away from staging is denied
- **WHEN** the current branch is `staging` and the command is `git switch release-1`
- **THEN** the decision is `deny` with reason `branch-protection: switch-off-protected`

#### Scenario: Checkout to a commit is not a branch switch
- **WHEN** the current branch is `main` and the command is `git checkout abc1234`
- **THEN** the decision is `allow` (target is not a branch; HEAD becomes detached)
- **AND** the reason MUST NOT cite branch-protection

#### Scenario: Checkout with flags and no explicit branch is not a branch switch
- **WHEN** the current branch is `main` and the command is `git checkout` or `git checkout -`
- **THEN** the decision is `allow`
- **AND** the branch-protection rule is not triggered

#### Scenario: Detached HEAD or git unavailable causes the rule to skip
- **WHEN** `git` signals are unavailable or `current_branch` is `"HEAD"` (detached)
- **THEN** the branch-protection rule is skipped and the decision follows the remaining rules

#### Scenario: Switching on the same branch is allowed
- **WHEN** the current branch is `main` and the command is `git checkout main` or `git switch main`
- **THEN** the decision is `allow`
- **AND** the reason MUST NOT cite branch-protection

### Requirement: Protected-branch set is configurable
The system SHALL read the protected-branch list from environment variable `PIOPANET_PROTECTED_BRANCHES` as a comma-separated list. The default list SHALL be `main,staging,dev,test,master`. An empty value SHALL disable the rule entirely.

#### Scenario: Default protected branches
- **WHEN** `PIOPANET_PROTECTED_BRANCHES` is not set
- **AND** the current branch is `dev` and the command is `git checkout feature`
- **THEN** the decision is `deny`

#### Scenario: Custom protected branches
- **WHEN** `PIOPANET_PROTECTED_BRANCHES` is set to `trunk,develop`
- **AND** the current branch is `trunk` and the command is `git checkout feature`
- **THEN** the decision is `deny`
- **AND** when the current branch is `main` and the command is `git checkout feature`
- **THEN** the decision is `allow`

#### Scenario: Empty list disables the rule
- **WHEN** `PIOPANET_PROTECTED_BRANCHES` is set to `""`
- **AND** the current branch is `main` and the command is `git checkout feature`
- **THEN** the decision is `allow`
- **AND** the branch-protection rule is not triggered

### Requirement: Branch-protection rule is fail-open on missing signals
The system SHALL evaluate the branch-protection rule only when `input.signals.git.available` is `true` and `current_branch` is a non-empty branch name. In all other cases the rule SHALL be inert.

#### Scenario: Non-repo cwd
- **WHEN** the evaluated command is `git checkout feature` in a directory that is not a git repository
- **THEN** the decision is `allow` (the remaining policy still applies; branch-protection does not fire)

#### Scenario: Git missing from PATH
- **WHEN** `git` is not available
- **THEN** `signals.git.available` is `false`
- **AND** the branch-protection rule is skipped

## MODIFIED Requirements

_(none — this is a new capability for the project.)_

## REMOVED Requirements

_(none — this is a new capability for the project.)_
