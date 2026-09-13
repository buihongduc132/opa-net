# rule-unlock-keys — tasks

> TDD discipline: each task = RED test first, then GREEN impl. RED and GREEN are SEPARATE sub-agents (parent custom prompt).
> Worktree: `.worktrees/wt-rule-unlock-keys/` on branch `rule-unlock-keys`.

## Phase 0 — Scaffolding (PARENT does directly)

- [x] T0.1 Create worktree `.worktrees/wt-rule-unlock-keys` off `origin/main`, symlink node_modules
- [x] T0.2 Verify baseline: `bun test` shows 183 pass / 0 fail; `bun run typecheck` clean
- [x] T0.3 Capture openspec change `rule-unlock-keys/` (proposal.md, design.md, this file, spec.md)

## Phase 1 — RED (delegate RED sub-agent)

- [ ] T1.1 `tests/unit/unlock/KeyDerivation.test.ts` — HMAC deterministic; salt-sensitive; 16 hex output; rejects empty rule_id
- [ ] T1.2 `tests/unit/unlock/KeyParser.test.ts` — parses `ll_<16hex>`; parses `ttl.<exp>.<16hex>`; rejects malformed; rejects wrong prefix; rejects bad hex
- [ ] T1.3 `tests/unit/unlock/KeyVerifier.test.ts` — valid LL; valid TTL (now<exp); expired TTL (now>exp); wrong-rule; wrong-salt; unlocks with correct rule_id only; TTL clock strict (no skew tolerance)
- [ ] T1.4 `tests/unit/unlock/UnlockFilter.test.ts` — single rule + valid key → bypassed; single rule + wrong key → blocked; multi-rule all-unlocked → allow; multi-rule partial-unlocked → blocked (`unlock_blocked_count` correct); empty keys → all blocked; expired TTL key → `unlock_status:'expired'`, NOT bypassed
- [ ] T1.5 `tests/unit/unlock/SaltResolver.test.ts` — reads existing salt; auto-generates on first read (32 bytes, mode 0o600); `O_CREAT|O_EXCL` atomic (two concurrent calls → same file); env override `PIOPANET_UNLOCK_SALT` wins; warns if file mode != 0o600
- [ ] T1.6 `tests/unit/audit/NoOpSink.test.ts` — `onUnlock()` returns void, no throw, no side effect
- [ ] T1.7 `tests/unit/output/DecisionBuilder.unlock.test.ts` — when `engineDecision.unlockResult.bypassedCount > 0` → `source:'opa-unlocked'`, `metadata.unlock_count`, `unlock_blocked_count`; TTL reason has `unlock_expires_at`; expired TTL → `unlock_status:'expired'`, severity stays 'block'; reasons[].bypassed reflected
- [ ] T1.8 `tests/unit/config/Config.unlock.test.ts` — parses `PIOPANET_UNLOCK_KEYS` (comma-separated); parses `--unlock` (via opts); non-empty keys → forces `cacheTtlMs=0` (LD-G3); reads `PIOPANET_UNLOCK_SALT`, `PIOPANET_UNLOCK_SALT_FILE`, `PIOPANET_AGENT_ID`
- [ ] T1.9 `tests/unit/cli/run.unlock-filter-error.test.ts` — unlock filter throws → falls back to un-filtered engine decision, `source:'unlock-filter-error'`, never allows-by-accident (LD-G8)
- [ ] T1.10 `tests/unit/cli/run.fail-open-keyless.test.ts` — OPA down (`source:'fail-open'`) + keys present → `source:'fail-open-keyless'` (NOT `opa-unlocked`), bypassed=false everywhere (LD-G1)
- [ ] T1.11 `tests/unit/cli/run.unlock-stdin.test.ts` — `--unlock-stdin` requires positional command arg (LD-G2); reads key from stdin; rejects when command also on stdin
- [ ] T1.12 `tests/unit/cli/unlock-key-subcommand.test.ts` — `unlock-key <rule_id>` → prints `ll_<16hex>`; `--ttl 3600` → prints `ttl.<exp>.<16hex>` with exp ≈ now+3600; `--list` → enumerates catalog rule_ids; refuses unknown rule_id
- [ ] T1.13 `tests/unit/schema/decision-output.unlock.test.ts` — additive fields validate (`bypassed`, `unlock_key_id`, `unlock_key_type`, `unlock_expires_at`, `unlock_status`, `unlock_count`, `unlock_blocked_count`, `unlock_agent`); new `source` enum values accepted (`opa-unlocked`, `fail-open-keyless`, `unlock-filter-error`); unknown fields still rejected (`additionalProperties:false` preserved)
- [ ] T1.14 `tests/e2e/unlock-flow.test.ts` — full: mint key via `unlock-key` subcommand → set env → eval `git stash pop` → `source:'opa-unlocked'`, exit 0; without key → deny, exit 2; expired TTL → still deny with `unlock_status:'expired'`
- [ ] T1.15 RED-gate: `bun test` shows all new tests FAIL (assertion / import errors OK), existing 183 stay PASS

## Phase 2 — GREEN (delegate GREEN sub-agent, separate from RED)

- [ ] T2.1 `src/unlock/KeyDerivation.ts` — `derive(salt: Buffer, rule_id: string): string` returns 16 hex
- [ ] T2.2 `src/unlock/KeyParser.ts` — `parse(raw: string): ParsedKey | null` (ll | ttl | null)
- [ ] T2.3 `src/unlock/KeyVerifier.ts` — `verify(parsed, rule_id, salt, now): {valid, reason?, keyType, expiresAt?}`
- [ ] T2.4 `src/unlock/SaltResolver.ts` — `resolve(): Buffer`; auto-gen with `wx` flag + mode 0o600; env override; warn on bad mode
- [ ] T2.5 `src/unlock/UnlockFilter.ts` — `filter(reasons, keys, salt, now): UnlockResult`; all-or-nothing (LD-G6); try/catch at caller (T2.10)
- [ ] T2.6 `src/unlock/types.ts` — `ParsedKey`, `UnlockResult`, `UnlockReasonInfo` interfaces
- [ ] T2.7 `src/audit/AuditSink.ts` — `AuditSink` interface + `NoOpSink` impl
- [ ] T2.8 `schemas/decision-output.v1.json` — additive fields + new enum values; `additionalProperties:false` preserved everywhere
- [ ] T2.9 `src/config/Config.ts` — `unlockKeys`, `unlockSaltPath`, `unlockAgentId`, `cacheTtlMs` forced 0 when keys present
- [ ] T2.10 `src/cli/run.ts` — wire unlock filter (try/catch → `unlock-filter-error`); fail-open-keyless source override (LD-G1); `--unlock` / `--unlock-stdin` flag parsing (LD-G2)
- [ ] T2.11 `src/output/DecisionBuilder.ts` — accept `UnlockResult`; set `source:'opa-unlocked'` when bypassed; demote bypassed reason severity; populate `metadata.unlock_*`
- [ ] T2.12 `src/output/OutputFormatter.ts` — emit `opa-unlocked` / `fail-open-keyless` / `unlock-filter-error` correctly (exit 0 on unlock-allow, 2 on partial-block)
- [ ] T2.13 `src/cli/unlock-key.ts` (new) — subcommand handler: mint LL or TTL key, `--list` enumerate catalog
- [ ] T2.14 `bin/pi-opa-net.js` — dispatch `unlock-key` subcommand
- [ ] T2.15 GREEN-gate: `bun test` shows ALL tests PASS (new + existing 183); `bun run typecheck` clean; `bun run lint` clean

## Phase 3 — Parent verification (PARENT does directly)

- [ ] T3.1 Manual smoke: `bun run smoke` clean
- [ ] T3.2 Schema smoke: build a sample decision record with all unlock fields, validate against schema
- [ ] T3.3 `git add -A` + commit on branch `rule-unlock-keys` (no `git add .` per project rule)

## Phase 4 — Quality gate (jewilo verifier-loop, MANDATORY)

- [ ] T4.1 Configure `~/.verifier-loop/config.json` n/m ≥2 verifiers, backend=pi, rag-quick model
- [ ] T4.2 Run `jewilo NEW "..."` (detached via pm2 if long); get `mmddyy-XXXXXXXX` hash
- [ ] T4.3 On REJECT: read rejection notes → fix root cause → `jewilo RESUME <goalId> --fix "..."`

## Phase 5 — PR + merge + test as jewilo-dev + deploy (PARENT does directly)

- [ ] T5.1 `gh pr create` on branch `rule-unlock-keys` (per pr-creation skill)
- [ ] T5.2 Merge to main (YOLO mode — autonomous)
- [ ] T5.3 Switch back to main checkout, `git pull`, `bun install`, `bun test` on merged code
- [ ] T5.4 Test merged code AS jewilo-dev (dump model = rag-quick in bhd-litellm) — config + test self
- [ ] T5.5 If jewilo-dev success → deploy to jewilo (per cli-agents-deploy skill)

## Phase 6 — Close findings threads

- [ ] T6.1 Update `flow/findings/2026-07-20-rule-unlock-keys/2026-07-20-open-threads.yaml` — OT1 status=resolved (openspec captured), OT2 still open (ospx manifest enumeration — escalated to user, low priority)
