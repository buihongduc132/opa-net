# Appendix to Turn 4 — YAGNI seams + ship surface gotchas (batch B)

> Gotcha coverage for: Turn 4 (./2026-07-20-turn4-yagni-finalize-seams.md)
> Sub-agent: reviewer (batch B)
> Items reviewed: LD-Y1, LD-Y2, TTL design, ship surface, OT1
> Source: `.pi-subagents/artifacts/outputs/99e702dc.../solutions/batch-b-gotchas.md`

---

## Findings (ranked)

### Rank 4 (Significant)

- **Schema `additionalProperties: false` blocks all proposed additive fields**
  - What: The current schema has `additionalProperties: false` at 4 levels: root, Reason, EvaluatedInput, DecisionMetadata. The proposed changes add: `source: 'opa-unlocked'` (new enum value), `reasons[].bypassed`, `reasons[].unlock_key_id`, `reasons[].unlock_key_type`, `reasons[].unlock_expires_at`, `reasons[].unlock_status`, `metadata.unlock_count`, `metadata.unlock_agent`. EVERY ONE of these requires a schema change. The design says "additive, v1 stays" but `additionalProperties: false` means NOTHING is additive without explicit schema edits.
  - Why missed: Design discusses schema delta in terms of "add fields" but doesn't account for the strict `additionalProperties: false` constraint.
  - Severity: If schema isn't updated in lockstep with code, `validateDecision()` throws → entire pipeline crashes on any unlock event. This is a hard blocker.
  - Mitigation: Schema update is NOT optional — it's part of the ship surface. Add explicit schema edit tasks.

- **DecisionBuilder.source type doesn't include 'opa-unlocked'**
  - What: `DecisionOutput.source` is typed as `'opa' | 'fail-open' | 'fail-closed' | 'cached'`. The design adds `'opa-unlocked'` but this requires changing the TypeScript type AND the `EngineDecision.source` type in `src/engine/types.ts`. The unlock filter doesn't change the engine's source — it changes the OUTPUT source. But DecisionBuilder gets source from `engine.source`, not from the unlock filter.
  - Why missed: Design says "TS-side post-eval filter" but doesn't specify HOW the source field transitions from `'opa'` to `'opa-unlocked'`.
  - Severity: Type error at compile time. If forced with `as`, runtime schema mismatch.
  - Mitigation: Define the handoff: UnlockFilter returns a modified `EngineDecision` with `source: 'opa-unlocked'` when any rule is bypassed. Or: DecisionBuilder accepts an unlock result and overrides source.

- **TTL key format ambiguity — `ttl.` prefix collides with potential future prefixes**
  - What: Format `ttl.<unix-exp>.<16hex>` uses dots as separators. If a future key type also uses dots, parsing becomes ambiguous. Worse: if the 16hex portion happens to start with characters that look like a prefix, a naive split could misparse.
  - Why missed: Design uses `.` as separator but doesn't reserve the namespace or define a formal grammar.
  - Severity: Future key types break parser. Not today's problem but the prefix namespace is implicitly unbounded.
  - Mitigation: Define formal BNF: `key = "ll_" hex16 | "ttl." dec_unix_exp "." hex16`. Reserve `ll_` and `ttl.` as the only valid prefixes.

- **Unix expiry as decimal string — no validation of format**
  - What: `ttl.1753127056.7c2f8a1b...` — the expiry is a decimal unix timestamp. But what if someone passes `ttl.1.7c2f...`? Or `ttl.abc.7c2f...`? Or `ttl.-1.7c2f...`? Parser must handle all malformed variants.
  - Why missed: CA10 covers negative TTL at minting time but not at parsing/verification time.
  - Severity: Malformed key in env → crash or silent misparse.
  - Mitigation: KeyParser MUST: (1) split on `.`, expect exactly 3 parts for `ttl`, (2) `parseInt(exp, 10)` with strict check, (3) reject if `exp.toString() !== parts[1]`.

- **Fail-open + unlock interaction is undefined**
  - What: CA6 says "if OPA is down (source:fail-open), there's nothing to unlock; behavior unchanged." But consider: OPA is down → `source: 'fail-open'`, `decision: 'allow'`, `reasons: []`. The unlock filter has no deny reasons to process. This is correct. BUT: what if OPA returns SOME denies but the unlock filter bypasses ALL of them → `decision: 'allow'`, `source: 'opa-unlocked'`. Now OPA goes down on the NEXT call → `source: 'fail-open'`. The agent sees alternating `opa-unlocked` and `fail-open` sources. This is fine for behavior but confusing for audit.
  - Why missed: CA6 only covers the "OPA fully down" case, not the "OPA flapping" case.
  - Severity: Audit confusion. Agent behavior is correct but the source field oscillates.
  - Mitigation: Document: `fail-open` and `opa-unlocked` can coexist in the same session. Audit consumers should not interpret source oscillation as instability.

### Rank 3 (Moderate)

- **Salt file race on first-use auto-generation**
  - What: Two concurrent `pi-opa-net unlock-key` invocations on first run both detect missing salt → both generate → last-write-wins. Keys minted against the first salt become invalid once the second overwrites it.
  - Why missed: Design says "auto-generated on first use" but doesn't specify atomic write-or-verify semantics. Classic TOCTOU.
  - Severity: Keys minted under stale salt silently fail verification.
  - Mitigation: Use `O_CREAT | O_EXCL` (or `wx` flag) for salt file creation. Loser re-reads the winner's file. Or: generate into temp file, `rename()` atomically.

- **Salt file permissions default to world-readable**
  - What: `~/.pi-opa-net/salt` contains the root secret for all unlock keys. If created with default umask (022 → file mode 644), any user on the box reads it → derives all keys → full bypass.
  - Why missed: Design specifies location and env override but never mentions `chmod 600` / `0o600` on creation.
  - Severity: Multi-user box = total security bypass. Single-user box = no impact.
  - Mitigation: SaltResolver MUST `fs.writeFileSync(path, salt, { mode: 0o600 })` on creation. Verify on read: warn if mode != 600.

- **NoOpSink default means zero audit trail for unlock events**
  - What: With NoOpSink as default, unlock events are ONLY visible in the decision record JSON on stdout. If the consumer (pi hook, CI script) doesn't capture stdout, the unlock is invisible. No file, no log, no webhook.
  - Why missed: Design says "hook captures it" — but this assumes the hook is wired (which Turn 1 confirmed is NOT yet built).
  - Severity: Gap between "audit exists in theory" and "audit exists in practice." Until pi-opa-net-ext ships, unlock events are ephemeral.
  - Mitigation: Accept as known gap (YAGNI). But: decision record MUST be emitted on stderr or a file when unlock actually fires, not just stdout. Or: document that audit is contingent on hook wiring.

- **AuditSink.onUnlock() timing ambiguity — when does it fire?**
  - What: The interface says `onUnlock(record)` but the design doesn't specify WHEN it's called: before emit? After? Only on successful unlock? On failed unlock attempts too?
  - Why missed: Interface shape defined but lifecycle contract not.
  - Severity: If called before emit and sink throws, does the unlock still proceed? If called after emit and emit fails, was the unlock recorded?
  - Mitigation: Define contract: `onUnlock` fires AFTER decision record is finalized but BEFORE stdout emit. Sink exceptions are caught and logged (never block the unlock).

- **16 hex = 64 bits — birthday collision math is wrong for security context**
  - What: CA8 says "collision ~1/10^19, acceptable." That's the probability for a SINGLE pair. But with N rules and M keys per rule, the collision space is `N * M` keys. With 42 rules and 2 key types = 84 keys, collision probability is `84^2 / 2^65 ≈ 3.2e-16` — still tiny. BUT: the MAC is truncated to 16 hex (64 bits), which means the ACTUAL security strength is 64 bits = 2^64 ≈ 1.8e19. For a brute-force attack, an attacker who knows the rule_id can try 2^64 HMAC values. Without salt this is feasible with rainbow tables; WITH salt it's 2^64 per salt value.
  - Why missed: CA8 cites the collision probability but doesn't frame it as brute-force resistance.
  - Severity: For a local dev tool, 64-bit is probably fine. But if keys are ever exposed network-wide, it's weak.
  - Mitigation: Document that 16 hex is a TRUNCATED MAC for readability, not a security boundary. The salt provides the real security.

- **TTL key with exp=0 or exp in the past at mint time**
  - What: `pi-opa-net unlock-key <rule> --ttl 0` or `--ttl -1` → mints a key that's immediately expired. CA10 says "reject negatives" but doesn't cover `--ttl 0` or `--ttl 1` (expires in 1 second, before the agent can use it).
  - Why missed: CA10 covers negative rejection but not minimum TTL enforcement.
  - Severity: User mints key, hands to agent, agent tries to use it → expired. Confusing UX.
  - Mitigation: Enforce minimum TTL (e.g., 60 seconds). Reject `--ttl < 60` with clear error.

- **Clock source inconsistency — `now()` at verification vs `Date.now()` at minting**
  - What: KeyVerifier uses `now()` (injectable for tests). Key minting uses `Date.now()` (implicit). If the minting process and verification process have different clock sources, TTL could be wrong.
  - Why missed: Design specifies injectable `now()` for KeyVerifier but doesn't specify the minting side.
  - Severity: Minor on same machine. Could matter if keys are minted on one machine and verified on another with different NTP state.
  - Mitigation: Both minting and verification MUST use `Date.now()` (unix epoch seconds). Injectable `now()` in tests only.

- **UnlockFilter placement ambiguity — before or after DecisionBuilder?**
  - What: Design says "post-eval filter" and the architecture shows `PARSE → EVAL → UNLOCK FILTER → BUILD → EMIT`. But DecisionBuilder.buildReasons() sets `severity: 'block'` on ALL reasons. The unlock filter needs to demote bypassed reasons to `severity: 'info'` and add `bypassed: true`. Does this happen: (a) before builder.build() by modifying engine.reasons, (b) inside builder.build() as a new step, or (c) after builder.build() by mutating the output?
  - Why missed: Three different integration points, each with different implications for the DecisionBuilder API.
  - Severity: Wrong placement = either builder overwrites the filter's work, or filter can't access rule metadata.
  - Mitigation: Option (b) is cleanest: DecisionBuilder.build() accepts an optional `UnlockResult` in its deps. Inside `buildReasons()`, it checks if the rule_id is in the unlock set and adjusts severity + adds bypassed fields.

- **run.ts orchestration needs unlock key parsing BEFORE engine.evaluate**
  - What: Current `runCli()`: `resolveRaw → configFromEnv → parse → engine.evaluate → builder.build → validate → format`. The unlock filter needs keys parsed from env/args/stdin. But `engine.evaluate()` is where OPA runs. If unlock happens AFTER OPA, the engine already returned `decision: 'deny'` with reasons. The unlock filter then needs to change the decision to `'allow'` if all blocking reasons are bypassed. This means the `EngineDecision` is mutable, or the filter produces a new one.
  - Why missed: Design shows the pipeline but doesn't specify the data flow for decision mutation.
  - Severity: If the filter can't change `decision: 'deny'` → `'allow'`, the unlock doesn't work.
  - Mitigation: UnlockFilter takes `(engineDecision, unlockKeys)` → returns new `EngineDecision` with: (1) bypassed reasons removed from blocking set, (2) if blocking set empty → `decision: 'allow'`, `source: 'opa-unlocked'`, (3) bypassed reasons preserved in output with `bypassed: true`.

- **Schema validation runs AFTER builder but BEFORE formatter — unlock fields must be valid**
  - What: `validateDecision(output)` runs in run.ts after builder.build(). The output at this point must include all new unlock fields AND they must conform to the updated schema. If any unlock field is missing or malformed, validation throws.
  - Why missed: Design lists `validateDecision` as a "hard internal gate." New fields must be schema-valid at this point.
  - Severity: Validation failure → crash → no decision emitted → equivalent to fail-closed.
  - Mitigation: Ensure UnlockFilter + DecisionBuilder produce schema-complete output. Test with schema validation enabled.

- **No key revocation mechanism**
  - What: Once a key is minted and handed to an agent, it cannot be revoked except by rotating the salt (which kills ALL keys). No per-key revocation.
  - Why missed: Design explicitly chose "no server-side state." Revocation requires state.
  - Severity: If a specific key is compromised, the only response is salt rotation → all keys die → re-issue to all agents. Operational sledgehammer.
  - Mitigation: TTL keys mitigate this (they expire). For LL keys, accept the sledgehammer. Or: future "revocation list" file (YAGNI for now, but note the gap).

- **PIOPANET_UNLOCK_KEYS env var — delimiter not specified**
  - What: Design shows `PIOPANET_UNLOCK_KEYS=a3f9c2b8e1d4,...` with comma separation. But what if a key contains a comma? What about whitespace? Leading/trailing commas? Empty entries from `key1,,key2`?
  - Why missed: Delimiter choice is assumed but not specified.
  - Severity: Edge cases in env var parsing → keys silently dropped or misparsed.
  - Mitigation: Specify: comma-delimited, whitespace trimmed, empty entries rejected with warning. Add to KeyParser tests.

### Rank 2 (Minor)

- **PIOPANET_UNLOCK_SALT env var leaks via /proc**
  - What: Env vars are visible in `/proc/<pid>/environ` to any process with same UID. Salt in env = salt readable by any process the user runs.
  - Why missed: CA1 covers key leakage via `ps`/history but the salt env var is a higher-value target.
  - Severity: Adversarial process on same box → derives all keys.
  - Mitigation: Document the risk. Consider reading salt from a fd (e.g., `PIOPANET_UNLOCK_SALT_FD=3`) so the value never appears in `/proc/environ`. YAGNI: at minimum, document.

- **Salt rotation has no migration story**
  - What: When salt rotates, ALL existing keys — both LL and TTL — become invalid simultaneously. No grace period, no "old salt + new salt" dual-verify window.
  - Why missed: Design mentions "rotation = new salt = all old keys die" as a feature. But in practice, agents holding keys in their env will fail mid-session with no clear error.
  - Severity: Operational disruption.
  - Mitigation: On verification failure, check if key would validate against a "previous salt" (keep N=1 old salt). Log warning. Or: accept as-is but ensure error message says "salt may have rotated."

- **~/.pi-opa-net/ directory may not exist**
  - What: SaltResolver tries to write `~/.pi-opa-net/salt` but `~/.pi-opa-net/` doesn't exist yet. `fs.writeFileSync` throws ENOENT.
  - Why missed: Design assumes the directory exists. First-ever invocation won't have it.
  - Severity: Crash on first use.
  - Mitigation: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` before writing salt.

- **Decision record as audit is JSON-fragile**
  - What: Decision record is emitted as a single JSON line on stdout. If a consumer pipes through `jq` or a log aggregator that splits on newlines, and the JSON is pretty-printed (future debug mode), the audit record breaks across lines.
  - Why missed: Current OutputFormatter always emits compact JSON. But no invariant enforces "single line" in the schema or interface contract.
  - Severity: Minor today, breaks if anyone adds pretty-print.
  - Mitigation: Add explicit contract: decision record is ALWAYS single-line JSON on stdout.

- **No deduplication of unlock audit events**
  - What: If the same key is used for 100 evals in a session, 100 identical audit records are emitted. No "session-level" aggregation.
  - Why missed: Design is per-invocation. No concept of session-level unlock state.
  - Severity: Log volume.
  - Mitigation: Future FileAppendSink could dedup by `(unlock_key_id, rule_id)` per session. YAGNI for now but note the shape.

- **TTL key format leaks expiry time to eavesdroppers**
  - What: `ttl.1753127056.7c2f8a1b...` — the expiry timestamp is in plaintext. Anyone who sees the key knows EXACTLY when the key expires.
  - Why missed: Design prioritizes "self-describing" over "opaque."
  - Severity: Information leakage. Low impact for dev tool.
  - Mitigation: Accept as tradeoff. Document that TTL keys leak expiry by design.

- **Mixed LL + TTL keys for same rule — no precedence defined**
  - What: Design says "LL and TTL keys for same rule coexist." But what if both are present in `PIOPANET_UNLOCK_KEYS`? Does the unlock filter try both? Prefer one? Log both?
  - Why missed: Design shows them coexisting but doesn't define precedence or conflict resolution.
  - Severity: If LL is present, TTL is redundant. But both being valid means two audit entries for the same rule unlock.
  - Mitigation: Define: if multiple valid keys exist for the same rule, prefer TTL (more restrictive) over LL. Log both key_ids in audit. Or: first-match-wins.

- **6 new files in src/unlock/ may exceed the "max 10 files per directory" rule**
  - What: Project rules state "ALL directories MUST have MAXIMUM 10 files." src/unlock/ adds 6 files. Combined with potential test files and index.ts, this is close to the limit.
  - Why missed: Design counts source files but not the total directory population including index, tests colocated per project rules.
  - Severity: Minor organizational.
  - Mitigation: Keep the 6 source files + 1 index.ts = 7. Tests follow the project rule of colocating. If directory exceeds 10, split into `src/unlock/derive/` and `src/unlock/verify/`.

- **No index.ts / barrel export mentioned for src/unlock/**
  - What: Ship surface lists 6 files but no `index.ts` barrel. Existing modules use barrel exports.
  - Why missed: Implicit assumption that barrel is added.
  - Severity: Minor — import paths become verbose without barrel.
  - Mitigation: Add `src/unlock/index.ts` to ship surface. Same for `src/audit/index.ts`.

- **No locked-decisions.yaml artifact exists yet**
  - What: README.md references `2026-07-20-locked-decisions.yaml` as "immutable inputs" but this file doesn't appear to exist on disk. The openspec capture depends on it.
  - Why missed: Referenced in "pick up next time" but never created.
  - Severity: Missing artifact means the locked decisions exist only in prose.
  - Mitigation: Create the YAML file as part of OT1 capture. Or: inline the locked decisions in proposal.md.

- **No migration story for existing consumers of decision-output.v1**
  - What: Adding `source: 'opa-unlocked'` and new Reason fields changes the schema. Any existing consumer that does strict matching on `source` will NOT recognize `'opa-unlocked'` and may treat it as unknown/invalid.
  - Why missed: Design says "additive, v1 stays" but adding enum values IS a breaking change for strict consumers.
  - Severity: Depends on consumer count. Today: probably zero external consumers.
  - Mitigation: Document in proposal.md: "Consumers should treat unknown source values as opaque strings, not fail." Add to schema description.

- **OT1 scope creep — proposal + design + spec + tasks is 4 documents**
  - What: Mirroring `conditional-branch-gate` means 4 documents. For a feature that's 6 new files + 6 edits, that's heavy documentation overhead.
  - Why missed: Pattern-copy from sibling change.
  - Severity: YAGNI tension.
  - Mitigation: Consider a lighter capture: proposal.md + tasks.md only. Design decisions are already captured in the explore findings.

- **No rate limiting on unlock attempts**
  - What: An agent can try unlimited unlock keys per invocation. Brute-force attempts are not throttled.
  - Why missed: Design assumes possession-of-key = trust.
  - Severity: For a local dev tool, low risk.
  - Mitigation: YAGNI for now. But: KeyVerifier should log failed attempts. If performance becomes an issue, cap keys-per-invocation.

---

## Summary table

| Item | Rank | Count |
|------|------|-------|
| LD-Y1 (Salt) | 2-3 | 5 findings |
| LD-Y2 (Audit) | 2-4 | 4 findings |
| TTL design | 2-4 | 7 findings |
| Ship surface | 2-4 | 6 findings |
| OT1 (Openspec) | 2 | 3 findings |
| Cross-cutting | 2-4 | 3 findings |
| **Total** | | **28 findings** |

---

## Cross-turn references

- Also relevant to: Turn 2 §four design forks, Turn 3 §TTL design
