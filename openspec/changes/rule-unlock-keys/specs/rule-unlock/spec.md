---
name: rule-unlock-keys
status: proposed
---

# rule-unlock-keys spec

## ADDED Requirements

### Requirement: Key derivation is salted HMAC of rule_id
The system SHALL derive an unlock key as `HMAC-SHA256(salt, rule_id)` truncated to the first 16 hex characters (64-bit mac). The salt SHALL be 32 random bytes. Bare `sha256(rule_id)` (unsalted) MUST NEVER be used.

#### Scenario: Deterministic derivation
- **WHEN** `derive(salt, 'block-git-stash-mutations')` is called twice with the same salt
- **THEN** both calls return the same 16-hex string

#### Scenario: Salt sensitivity
- **WHEN** `derive(saltA, 'block-git-stash-mutations')` and `derive(saltB, 'block-git-stash-mutations')` are called with `saltA != saltB`
- **THEN** the two returned strings differ

#### Scenario: Output length
- **WHEN** `derive(salt, rule_id)` is called for any valid rule_id
- **THEN** the returned string is exactly 16 characters, all lowercase hex

### Requirement: Two key types via self-describing prefix
The system SHALL support two key types. Long-lived keys use prefix `ll_` followed by 16 hex (`ll_<16hex>`), derived from `HMAC(salt, rule_id)`. TTL keys use prefix `ttl.` followed by a unix expiry timestamp (seconds) and 16 hex (`ttl.<unix-exp-sec>.<16hex>`), derived from `HMAC(salt, rule_id + "." + str(exp))`.

#### Scenario: Parse long-lived key
- **WHEN** `parse('ll_a3f9c2b8e1d4abcd')` is called
- **THEN** it returns `{type:'ll', mac:'a3f9c2b8e1d4abcd'}`

#### Scenario: Parse TTL key
- **WHEN** `parse('ttl.1753127056.7c2f8a1b9e0cdddd')` is called
- **THEN** it returns `{type:'ttl', exp:1753127056, mac:'7c2f8a1b9e0cdddd'}`

#### Scenario: Reject malformed keys
- **WHEN** `parse` is called with `''`, `'foo'`, `'ll_'`, `'ll_xyz'`, `'ttl.notanumber.abc'`, `'ll_a3f9c2b8e1d4abc'` (15 hex), `'ll_a3f9c2b8e1d4abcde'` (17 hex)
- **THEN** it returns `null`

### Requirement: Salt is deploy-local with env override seam
The system SHALL load salt from `~/.pi-opa-net/salt` by default. If the file does not exist, the system SHALL auto-generate 32 cryptographically random bytes and write them atomically using `fs.writeFileSync(path, salt, {flag:'wx', mode:0o600})` (O_CREAT|O_EXCL). If two processes race, the loser SHALL re-read the winner's file. The system SHALL warn on read if the file mode is not `0o600`. The system SHALL accept env override `PIOPANET_UNLOCK_SALT` (literal value, for testing) which takes precedence over the file. The system SHALL accept env override `PIOPANET_UNLOCK_SALT_FILE` (path to salt file).

#### Scenario: Auto-generate on first read
- **GIVEN** `~/.pi-opa-net/salt` does not exist
- **WHEN** `SaltResolver.resolve()` is called
- **THEN** the file is created with 32 random bytes and mode 0o600
- **AND** the returned buffer matches the file content

#### Scenario: Atomic race on first-use
- **GIVEN** two concurrent `SaltResolver.resolve()` calls on a missing salt file
- **WHEN** both calls complete
- **THEN** both return the same salt (loser re-read winner's file; no last-write-wins)

#### Scenario: Env literal override
- **WHEN** `PIOPANET_UNLOCK_SALT=test-salt-literal` is set
- **THEN** `SaltResolver.resolve()` returns `Buffer.from('test-salt-literal')` without touching the file

#### Scenario: Warn on world-readable salt
- **GIVEN** salt file exists with mode 0o644
- **WHEN** `SaltResolver.resolve()` is called
- **THEN** a warning is emitted to stderr and the salt is still returned

### Requirement: Three delivery channels
The system SHALL accept unlock keys via three channels: `PIOPANET_UNLOCK_KEYS` env var (comma-separated list), `--unlock <key>` CLI flag (repeatable), and `--unlock-stdin` CLI flag (reads a single key from stdin). `--unlock-stdin` SHALL require a positional command argument (because stdin is consumed by the key); calling `--unlock-stdin` without a positional command argument SHALL exit non-zero with an error message.

#### Scenario: Env delivery
- **WHEN** `PIOPANET_UNLOCK_KEYS=ll_aaa,ll_bbb` is set
- **THEN** both keys are in the effective unlock set

#### Scenario: CLI flag delivery
- **WHEN** `pi-opa-net eval "git stash pop" --unlock ll_aaa --unlock ll_bbb` is invoked
- **THEN** both keys are in the effective unlock set

#### Scenario: Stdin delivery requires positional command
- **WHEN** `echo "<key>" | pi-opa-net eval --unlock-stdin` is invoked (no positional command)
- **THEN** exit code is non-zero
- **AND** stderr contains an error mentioning `--unlock-stdin requires a positional command argument`

#### Scenario: Stdin delivery with positional command
- **WHEN** `echo "<key>" | pi-opa-net eval "git stash pop" --unlock-stdin` is invoked
- **THEN** the key from stdin is in the effective unlock set and `"git stash pop"` is the command

### Requirement: No god-key
The system SHALL refuse any single key that unlocks every rule. Env var `PIOPANET_UNLOCK_ALL` MUST NOT be honored as a bypass mechanism. The refusal SHALL be documented in README.

#### Scenario: PIOPANET_UNLOCK_ALL ignored
- **WHEN** `PIOPANET_UNLOCK_ALL=<any value>` is set and a blocked command is run without per-rule keys
- **THEN** the decision is `deny` (god-key not honored)

### Requirement: Per-rule granularity
Each key SHALL unlock exactly one rule_id. One key SHALL unlock ALL commands that fire that rule, regardless of arguments. Per-command or per-argument keys SHALL NOT exist in v1.

#### Scenario: One key unlocks all verbs under one rule
- **GIVEN** key for `block-git-stash-mutations`
- **WHEN** agent runs `git stash pop`, `git stash drop`, `git stash push`, or `git stash clear` with that key
- **THEN** all four commands are allowed (same rule fired)

### Requirement: TTL strict clock semantics
TTL keys SHALL be valid iff `now <= exp` where `now` is the verifier's process clock (Date.now()/1000). There SHALL be no skew tolerance. Expired TTL keys SHALL be recorded in the decision as `unlock_status:'expired'` and MUST NOT bypass the rule.

#### Scenario: TTL valid within window
- **GIVEN** TTL key with `exp = now + 3600`
- **WHEN** agent uses the key
- **THEN** the key is valid and the rule is bypassed

#### Scenario: TTL expired
- **GIVEN** TTL key with `exp = now - 1`
- **WHEN** agent uses the key
- **THEN** the key is rejected as expired
- **AND** the decision records `unlock_status:'expired'` and `bypassed=false`
- **AND** the rule is NOT bypassed

### Requirement: All-or-nothing multi-rule semantics
The system SHALL allow the command iff every deny reason with `severity:'block'` has a matching valid key. Partial bypass SHALL NOT be allowed. The decision SHALL include `metadata.unlock_blocked_count` (number of block-severity reasons still blocking after unlock attempt).

#### Scenario: All reasons unlocked → allow
- **GIVEN** command fires rules A and B, agent holds valid keys for both
- **WHEN** agent runs the command
- **THEN** decision is `allow`, source is `'opa-unlocked'`, `metadata.unlock_count=2`, `metadata.unlock_blocked_count=0`

#### Scenario: Partial unlock → still blocked
- **GIVEN** command fires rules A and B, agent holds valid key for A only
- **WHEN** agent runs the command
- **THEN** decision is `deny`, source is `'opa'`, reasons[A].bypassed=true, reasons[B].bypassed=false, `metadata.unlock_blocked_count=1`

### Requirement: Unlock filter crash fail-mode
The system SHALL wrap the unlock filter in try/catch. On throw, the system SHALL fall back to the un-filtered engine decision (if the engine said deny, the decision stays deny). The decision SHALL record `source:'unlock-filter-error'`. The system SHALL NEVER allow a command by accident of a filter crash.

#### Scenario: Filter crash falls back to deny
- **GIVEN** engine decision is `deny` and the unlock filter throws (simulated fault)
- **WHEN** the pipeline runs
- **THEN** the final decision is `deny` with `source:'unlock-filter-error'`

#### Scenario: Filter crash never allows
- **GIVEN** engine decision is `deny` and the unlock filter throws
- **WHEN** the pipeline runs
- **THEN** the final decision is NEVER `allow` regardless of keys present

### Requirement: Fail-open with keys records keyless degradation
When OPA itself is unreachable (`source:'fail-open'`) AND unlock keys are present, the system SHALL record `source:'fail-open-keyless'` (NOT `'opa-unlocked'`). All reasons SHALL have `bypassed=false` (or field absent). The command is allowed (fail-open) but the bypass is auditable as degradation, NOT as legitimate unlock.

#### Scenario: OPA down + keys present
- **GIVEN** OPA binary is missing and `PIOPANET_UNLOCK_KEYS` is set
- **WHEN** any command runs
- **THEN** decision is `allow`, source is `'fail-open-keyless'`, all reasons have `bypassed=false`

### Requirement: Cache poisoning guard
When any unlock keys are present, the system SHALL force `cacheTtlMs=0` regardless of `PI_OPA_CACHE_TTL_MS`. No cache reads or writes SHALL occur on the unlock path.

#### Scenario: Cache disabled when keys present
- **GIVEN** `PI_OPA_CACHE_TTL_MS=300` and `PIOPANET_UNLOCK_KEYS` is non-empty
- **WHEN** the engine evaluates a command
- **THEN** `config.cacheTtlMs` is `0` and no cache operations occur

### Requirement: gcloud/bq rules out of scope
The system SHALL scope unlock to catalog-registered rules only. gcloud/bq rules (which have no canonical `rule_id`) SHALL be documented as out-of-scope. `pi-opa-net unlock-key --list` SHALL enumerate only catalog-registered rule_ids.

#### Scenario: --list excludes gcloud/bq
- **WHEN** `pi-opa-net unlock-key --list` is invoked
- **THEN** the output contains only rule_ids from `src/rules/catalog.ts`
- **AND** no gcloud/bq synthetic ids appear

### Requirement: Decision schema stays v1 with additive unlock fields
The system SHALL extend `decision-output.v1.json` additively. The `source` field enum SHALL gain `'opa-unlocked'`, `'fail-open-keyless'`, `'unlock-filter-error'`. Each entry in `reasons[]` MAY gain `bypassed:boolean`, `unlock_key_id:string` (first 8 hex only — full key MUST NEVER appear), `unlock_key_type:'ll'|'ttl'`, `unlock_expires_at:string` (ISO 8601, ttl only), `unlock_status:'valid'|'expired'`. The `metadata` object MAY gain `unlock_count:integer`, `unlock_blocked_count:integer`, `unlock_agent:string`. `additionalProperties:false` SHALL be preserved at every level. No existing field SHALL be removed or renamed, and the schema version SHALL stay `1.0`.

#### Scenario: Additive fields validate
- **GIVEN** a decision record with `source:'opa-unlocked'`, `reasons[0].bypassed=true`, `reasons[0].unlock_key_id='a3f9c2b8'`, `reasons[0].unlock_key_type='ll'`, `metadata.unlock_count=1`
- **WHEN** validated against the schema
- **THEN** validation passes

#### Scenario: Unknown fields still rejected
- **GIVEN** a decision record with an additional `reasons[0].evil_field=true`
- **WHEN** validated against the schema
- **THEN** validation fails (additionalProperties:false preserved)

#### Scenario: Full key never appears
- **GIVEN** any decision record emitted by the system
- **WHEN** inspected
- **THEN** no field contains the full 16-hex unlock key; only the 8-hex `unlock_key_id` may appear

### Requirement: AuditSink seam with NoOpSink default
The system SHALL expose an `AuditSink` interface with method `onUnlock(record): void`. The default implementation SHALL be `NoOpSink` (no side effect, no throw). The decision record SHALL be the sole audit surface in v1. Future sinks (`FileAppendSink`, `WebhookSink`) SHALL be addable via config without pipeline changes.

#### Scenario: NoOpSink is side-effect-free
- **WHEN** `NoOpSink.onUnlock(record)` is called with any record
- **THEN** no exception is thrown, no file is written, no network call is made

### Requirement: SaltResolver seam for future extension
The system SHALL expose a `SaltResolver` interface with method `resolve(): Buffer`. The default implementation SHALL read the deploy-local file with env override. Future resolvers (remote salt API, OS keychain) SHALL be addable by implementing the interface and swapping the default, with zero changes to callers.

#### Scenario: Default resolver reads file
- **WHEN** the default `SaltResolver` is constructed and `resolve()` is called
- **THEN** it returns the salt from `~/.pi-opa-net/salt` (or env override)

### Requirement: rule_id immutability
`rule_id` SHALL be treated as an immutable hash input. Renames SHALL forfeit all minted keys; new keys MUST be minted under the new id. CONTRIBUTING SHALL document this as a hard constraint.

#### Scenario: Rename invalidates keys
- **GIVEN** a key minted for `block-foo` and the catalog later renames the rule to `block-bar`
- **WHEN** the old key is presented
- **THEN** the key does not match `block-bar` (different HMAC input)
- **AND** the rule is NOT bypassed

### Requirement: CLI subcommand for key minting
The system SHALL expose `pi-opa-net unlock-key <rule_id>` which prints `ll_<16hex>` to stdout. The system SHALL expose `pi-opa-net unlock-key <rule_id> --ttl <sec>` which prints `ttl.<exp>.<16hex>` where `exp = floor(now/1000) + ttl`. The system SHALL expose `pi-opa-net unlock-key --list` which enumerates catalog-registered rule_ids. The system SHALL refuse to mint a key for an unknown rule_id.

#### Scenario: Mint long-lived key
- **WHEN** `pi-opa-net unlock-key block-git-stash-mutations` is invoked
- **THEN** stdout contains `ll_<16hex>` matching `HMAC(salt, 'block-git-stash-mutations').hex().slice(0,16)`

#### Scenario: Mint TTL key
- **WHEN** `pi-opa-net unlock-key block-git-stash-mutations --ttl 3600` is invoked
- **THEN** stdout contains `ttl.<exp>.<16hex>` where exp ≈ now+3600 (±2s)
- **AND** the 16hex matches `HMAC(salt, 'block-git-stash-mutations.' + str(exp)).hex().slice(0,16)`

#### Scenario: List rule_ids
- **WHEN** `pi-opa-net unlock-key --list` is invoked
- **THEN** stdout contains every rule_id from `src/rules/catalog.ts`, one per line

#### Scenario: Refuse unknown rule
- **WHEN** `pi-opa-net unlock-key block-nonexistent-rule` is invoked
- **THEN** exit code is non-zero
- **AND** stderr contains an error mentioning the unknown rule_id
