## ADDED Requirements

### Requirement: All active cc-safety-net rules SHALL be present in the OPA policy

The OPA policy (`policy/safety.rego`) and the TypeScript rule catalog (`src/rules/catalog.ts`) SHALL together enforce every rule defined in the active `cc-safety-net` user rulebook snapshot committed under `tests/fixtures/user-rules.rulebook.json`. Every rulebook `name` SHALL appear as a catalog `ruleId`, and every catalog entry SHALL map to a deny rule in `safety.rego` (or to a dynamic-message rule family for `gcloud`/`bq`).

#### Scenario: Rulebook rule count matches catalog

- **WHEN** the committed rulebook fixture is loaded
- **THEN** every rule `name` in the fixture SHALL exist as a `ruleId` in `src/rules/catalog.ts`

#### Scenario: Existing non-ported command still allowed

- **WHEN** a command is evaluated that is not targeted by any rule (e.g., `git status`)
- **THEN** the decision SHALL be `allow` with no deny reasons

### Requirement: Deny messages and rule IDs SHALL match the canonical rulebook

Each catalog entry's `message` SHALL equal the rulebook rule's `reason` field verbatim, and each catalog `ruleId` SHALL equal the rulebook rule's `name` field verbatim.

#### Scenario: Verbatim reason text

- **WHEN** the catalog is compared to the committed rulebook fixture
- **THEN** for every rulebook rule, the matching catalog entry's `message` SHALL equal the rulebook `reason` byte-for-byte

#### Scenario: Canonical rule IDs

- **WHEN** the catalog is compared to the committed rulebook fixture
- **THEN** every rulebook `name` SHALL appear unchanged as a catalog `ruleId`

### Requirement: tmux server kill SHALL be blocked

The policy SHALL deny `tmux kill-server` because killing the tmux/wezterm server destroys all sessions, panes, and in-flight work across every client.

#### Scenario: tmux kill-server is denied

- **WHEN** the command `tmux kill-server` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-tmux-kill-server`

### Requirement: tmux kill-session SHALL be blocked

The policy SHALL deny `tmux kill-session` regardless of arguments, because killing a tmux session destroys all panes and in-flight work in that session.

#### Scenario: tmux kill-session -t is denied

- **WHEN** the command `tmux kill-session -t foo` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-tmux-kill-session`

#### Scenario: tmux kill-session -a is denied

- **WHEN** the command `tmux kill-session -a` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-tmux-kill-session`

#### Scenario: read-only tmux commands remain allowed

- **WHEN** the command `tmux ls` is evaluated
- **THEN** the decision SHALL be `allow`

### Requirement: pkill against tmux/wezterm SHALL be blocked

The policy SHALL deny `pkill` when any argument token is `tmux`, `wezterm`, or `wezterm-mux-server`, because killing these processes destroys all terminal sessions.

#### Scenario: pkill tmux is denied

- **WHEN** the command `pkill tmux` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-pkill-tmux-wezterm`

#### Scenario: pkill -9 wezterm is denied

- **WHEN** the command `pkill -9 wezterm` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-pkill-tmux-wezterm`

#### Scenario: pkill -f wezterm-mux-server is denied

- **WHEN** the command `pkill -f wezterm-mux-server` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-pkill-tmux-wezterm`

#### Scenario: pkill of an unrelated process remains allowed

- **WHEN** the command `pkill firefox` is evaluated
- **THEN** the decision SHALL be `allow`

### Requirement: killall against tmux/wezterm SHALL be blocked

The policy SHALL deny `killall` when any argument token is `tmux`, `wezterm`, or `wezterm-mux-server`.

#### Scenario: killall tmux is denied

- **WHEN** the command `killall tmux` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-killall-tmux-wezterm`

#### Scenario: killall wezterm is denied

- **WHEN** the command `killall wezterm` is evaluated
- **THEN** the decision SHALL be `deny` and the matched rule SHALL be `block-killall-tmux-wezterm`

#### Scenario: killall of an unrelated process remains allowed

- **WHEN** the command `killall vim` is evaluated
- **THEN** the decision SHALL be `allow`

### Requirement: Parity test SHALL cover the full rulebook

The catalog-parity test SHALL load the committed rulebook fixture and assert that every rulebook `tests[]` fixture with `expect: "blocked"` resolves to the matching rule, and that every `expect: "allowed"` fixture evaluates to `allow`.

#### Scenario: All blocked fixtures match their rule

- **WHEN** the rulebook fixture's blocked tests are run through the engine
- **THEN** each SHALL produce a deny whose `rule_id` equals the fixture's `rule` field

#### Scenario: All allowed fixtures evaluate to allow

- **WHEN** the rulebook fixture's allowed tests are run through the engine
- **THEN** each SHALL produce an allow decision with no deny reasons
