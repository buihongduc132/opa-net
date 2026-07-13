## ADDED Requirements

### Requirement: Signal collection enriches the OPA input with runtime context
The system SHALL collect a `signals` object before OPA evaluation and merge it into the `input` sent to the Rego policy. Signals collection SHALL be fail-open: any collector failure MUST result in an absent or disabled signal, never an abort or deny.

#### Scenario: Git signal collected successfully
- **WHEN** a command is evaluated inside a git repository whose current branch is `main`
- **THEN** `input.signals.git.current_branch` equals `"main"` and `input.signals.git.available` is `true`

#### Scenario: Git signal is unavailable outside a repository
- **WHEN** a command is evaluated outside a git repository or `git` is not on PATH
- **THEN** `input.signals.git.current_branch` is `null` and `input.signals.git.available` is `false`
- **AND** the evaluation still completes and returns an `allow`/`deny` decision

#### Scenario: Non-git commands skip git signal collection
- **WHEN** a non-git command (e.g. `docker stop`) is evaluated
- **THEN** git signal collection is not invoked
- **AND** `input.signals.git` is absent from the OPA input

#### Scenario: Collector error does not block evaluation
- **WHEN** a git signal collector throws or exits non-zero
- **THEN** the evaluator records `available: false` for that signal
- **AND** the policy evaluation proceeds with the remaining input intact

### Requirement: Git signal is collected relative to the command's working directory
The system SHALL run the git signal collection with the same `cwd` that the guarded command would execute in. The current working directory SHALL be threaded through from the evaluator to the collector.

#### Scenario: Different repos have different current branches
- **WHEN** `git checkout feature` is evaluated in a repo on branch `main`
- **AND** `git checkout feature` is evaluated in a repo on branch `side`
- **THEN** the first evaluation receives `input.signals.git.current_branch = "main"`
- **AND** the second evaluation receives `input.signals.git.current_branch = "side"`

### Requirement: Signal results are surfaced in the decision record
The system SHALL include the collected signals in the `decision-output.v1` record under a `signals` field so that every decision is auditable.

#### Scenario: Deny due to branch protection shows the branch
- **WHEN** a command is denied because of the protected-branch rule
- **THEN** the decision record contains `signals.git.current_branch` with the value that triggered the deny
- **AND** the decision record contains `signals.git.target_branch` with the parsed target branch

#### Scenario: Signals absent when collection skipped
- **WHEN** a non-git command is evaluated
- **THEN** the decision record either omits the `signals` field entirely OR sets `signals.git.available` to `false`

## MODIFIED Requirements

_(none — this is a new capability for the project.)_

## REMOVED Requirements

_(none — this is a new capability for the project.)_
