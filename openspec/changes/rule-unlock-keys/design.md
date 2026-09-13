## Context

pi-opa-net v0.1.0 evaluates a parsed command struct (`{program, subcommand, args, raw}`) against `policy/safety.rego` and emits a `decision-output.v1` record. Every deny is absolute — there is no per-rule escape hatch. cc-safety-net (the upstream) shares the same wall: its token-OR matcher cannot express per-rule secrets.

The user wants a capability model: a key, derived from the rule, that a trusted agent holds and presents to bypass exactly that rule. Possession of key = capability. No agent allowlist, no config flag — just secret-gated per-rule bypass.

Locked decisions (immutable inputs, see `flow/findings/2026-07-20-rule-unlock-keys/2026-07-20-locked-decisions.yaml`):
- LD-L1 granularity = K1 per-rule
- LD-L2 no god-key
- LD-L3 two key types (long-lived + TTL)
- LD-L4 delivery = ENV + --unlock + --unlock-stdin
- LD-L6 unlock check lives TS-side post-eval filter
- LD-Y1 salt = deploy-local default + env override seam
- LD-Y2 audit = decision-record only + NoOp sink seam
- LD-G1 accept fail-open-keyless degradation + audit
- LD-G2 --unlock-stdin requires positional command arg
- LD-G3 force cacheTtlMs=0 when keys present
- LD-G4 scope unlock to catalog-registered rules (gcloud/bq out)
- LD-G5 salt-rotation-only LL revocation
- LD-G6 allow ⟺ ALL blocking reasons unlocked
- LD-G7 rule_id is immutable hash input
- LD-G8 unlock filter crash → fall back to un-filtered decision

Current relevant code:
- `policy/safety.rego` — `package safety`, `default allow := true`, `deny[msg]` blocks. UNCHANGED by this design.
- `src/cli/run.ts` — `runCli()` orchestration: resolveRaw → configFromEnv → parse → engine.evaluate → builder.build → validateDecision → formatter.format. Unlock filter injects between engine.evaluate and builder.build.
- `src/output/DecisionBuilder.ts` — owns schema assembly. Accepts unlock result and overrides `source` to `'opa-unlocked'` when any reason bypassed.
- `src/util/digest.ts` — existing SHA-256 helper. Unlock uses `crypto.createHmac` directly (HMAC, not bare hash).
- `src/rules/catalog.ts` — `RULES` catalog. rule_id is the HMAC input. NO CHANGE needed.
- `src/config/Config.ts` — `EngineConfig`, env resolution. Gains `unlockKeys: string[]`, `unlockSaltPath`, `unlockAgentId`, `cacheTtlMs` (force 0 when keys).
- `schemas/decision-output.v1.json` — additive fields + enum values.

## Goals / Non-Goals

**Goals:**
- Capability-based per-rule bypass for trusted agents.
- Salted HMAC keys (deploy-local salt) — no rainbow tables.
- Two lifetimes (long-lived + TTL) sharing one verifier.
- All bypasses visible in decision record (`source:'opa-unlocked'`, `reasons[].bypassed=true`, truncated `unlock_key_id`).
- YAGNI seams for salt + audit so future extension is config-only.
- Zero policy file changes — unlock is a TS-side concern.
- All existing 183 tests stay green; schema stays v1.

**Non-Goals:**
- No single-use / per-command keys (K3 dropped).
- No god-key.
- No revocation list (salt rotation only).
- No gcloud/bq unlock.
- No pi-extension wiring (still OT5).
- No persistent audit log file (decision record + NoOp seam only).
- No remote/keychain salt fetcher.

## Decisions

### D1 — Keys live TS-side, policy file UNCHANGED (LD-L6)
**Choice:** Unlock filter sits between `engine.evaluate()` and `builder.build()` in `runCli()`. Policy file `safety.rego` is not modified.

**Why:** Two-halves architecture → becomes three halves (parse / decide / unlock). Keys never enter OPA input, never appear in OPA traces, never ship in the policy bundle. Scheme changes (rotation, new lifetime, etc.) are code edits, not policy redeploys.

**Alternatives rejected:**
- *Rego-side check* — OPA crypto builtins are limited, keys visible in trace, scheme change requires policy edit. Rejected.
- *Engine wrapper* — couples unlock to OPA engine; harder to test in isolation.

### D2 — HMAC-SHA256(salt, rule_id) → 16 hex (64-bit mac)
**Choice:** `key_mac = createHmac('sha256', salt).update(rule_id).digest('hex').slice(0, 16)`. Salt is 32 random bytes from `~/.pi-opa-net/salt`.

**Why:** Salt defeats rainbow tables (rule_ids are public in `tests/fixtures/user-rules.rulebook.json`). 16 hex = 64 bits → collision ~1/10^19 (LD-CA8). HMAC (not bare SHA) so salt stays secret under known-message attack.

**Alternatives rejected:**
- *Bare sha256(rule_id)* — publishable rainbow table. Rejected (CA7).
- *Full 64 hex* — overkill; 16 hex readable, mintable, unguessable.

### D3 — Two key types via self-describing prefix (LD-L3)
**Choice:**
```
long-lived:  ll_<16hex>           derived = HMAC(salt, rule_id)
TTL:         ttl.<exp>.<16hex>    derived = HMAC(salt, rule_id + "." + str(exp))
                                  valid iff now <= exp
```

**Why:** TTL state lives IN the key, not on disk. No `.unlock-state` file to corrupt or sync. Minter and verifier agree on `exp` because it's in the key string. Same salt, same rule → LL and TTL keys coexist (agent picks whichever fits).

**Alternatives rejected:**
- *Server-side TTL state file* — corruptible, race-prone, contradicts no-server-state.
- *Separate verifier per type* — duplicates code, drift risk.

### D4 — Salt is deploy-local file with env override seam (LD-Y1)
**Choice:** `SaltResolver` interface: `resolve(): Buffer`. Default impl reads `~/.pi-opa-net/salt` (or `PIOPANET_UNLOCK_SALT_FILE`); env override `PIOPANET_UNLOCK_SALT` (literal value, for testing). Auto-generate 32 random bytes on first read if missing (atomic `O_CREAT|O_EXCL`, mode 0o600). Warn on read if file mode != 0o600.

**Why:** YAGNI. Deploy-local = machine-specific keys, compromise isolated. Env override seam lets future `RemoteSaltResolver` drop in with zero caller changes.

**Alternatives rejected:**
- *Global shared salt* — transferable but weaker; rejected per YAGNI.
- *User keychain* — out of scope for v1; SaltResolver seam enables it later.

### D5 — All-or-nothing multi-rule semantics (LD-G6)
**Choice:** `UnlockFilter.filter(reasons, keys)` returns `{allow, bypassedReasons}`. `allow ⟺ every severity:'block' reason has matching valid key`. Schema adds `metadata.unlock_blocked_count` (remaining blocked after unlock attempt).

**Why:** Partial bypass is an undefined output state. If agent holds key for rule A but not rule B, command stays blocked. The decision record shows which reasons were bypassed and which remain.

**Alternatives rejected:**
- *Any-key-unlocks* — security hole (one weak key = total bypass). Rejected.
- *Per-reason partial* — undefined semantics, breaks audit clarity.

### D6 — Filter crash falls back to un-filtered decision (LD-G8)
**Choice:** `runCli()` wraps `unlockFilter.filter()` in try/catch. On throw, the engine decision passes through UNCHANGED (if OPA said deny, stay deny). Decision record gets `source:'unlock-filter-error'` for audit. Never allow-by-accident.

**Why:** No alternative. If filter crashes, the only safe behavior is to honor the engine's original verdict. Adding a fail-open here would create an exploit path (attacker induces filter crash → bypass).

**Alternatives rejected:**
- *Crash propagates* — whole pipeline throws, bin wrapper behavior undefined. Rejected.
- *Fail-open on filter crash* — security hole. Rejected.

### D7 — Fail-open with keys = keyless bypass, audited (LD-G1)
**Choice:** When OPA itself is down (`source:'fail-open'`), unlock filter has nothing to filter → command allowed regardless of keys. Decision record gets `source:'fail-open-keyless'` (not `'opa-unlocked'`) so the bypass is auditable as degradation, NOT as a legitimate unlock.

**Why:** YAGNI. User threat model is trusted agents. Fail-closed-when-keys-present adds cascading failure (OPA down + keys = all blocked). Audit visibility via distinct source is the cheap mitigation.

**Alternatives rejected:**
- *Fail-closed when keys present* — adds new failure mode, cascading block. Rejected per YAGNI.

### D8 — Cache poisoned when keys present → force cacheTtlMs=0 (LD-G3)
**Choice:** `Config.fromEnv()` detects non-empty `unlockKeys` and forces `cacheTtlMs = 0` regardless of `PI_OPA_CACHE_TTL_MS`.

**Why:** Cache is keyed on parsed command. Without this, Agent A's keyed allow poisons Agent B's keyless hit. Disabling cache on the unlock path is simpler and safer than hashing the unlock-set into the cache key.

**Alternatives rejected:**
- *Cache key includes hash of unlock-set* — complexity, and cache is not enabled by default anyway.

### D9 — Audit is decision-record-only with NoOp sink seam (LD-Y2)
**Choice:** `AuditSink` interface: `onUnlock(record: UnlockRecord): void`. Default impl `NoOpSink` does nothing. The decision record (stdout JSON) IS the audit. Future `FileAppendSink` / `WebhookSink` swap in via config without pipeline changes.

**Why:** YAGNI. Decision record already has `source:'opa-unlocked'`, `unlock_count`, `unlock_agent`, `reasons[].bypassed`, truncated `unlock_key_id`. Hook captures it. No file to manage, rotate, or back up.

**Alternatives rejected:**
- *Append ~/.pi-opa-net/unlock.log* — extra surface, rotation, permissions. Defer via seam.

### D10 — Schema additive, stays v1
**Choice:** Add to `decision-output.v1.json`:
- `source` enum gains `'opa-unlocked'`, `'fail-open-keyless'`, `'unlock-filter-error'`.
- `reasons[]` gains optional `bypassed: boolean`, `unlock_key_id: string` (8 hex), `unlock_key_type: 'll'|'ttl'`, `unlock_expires_at: string` (ISO, ttl only), `unlock_status: 'valid'|'expired'`.
- `metadata` gains `unlock_count: integer`, `unlock_blocked_count: integer`, `unlock_agent: string`.

**Why:** LD5 locks v1. No field removed, no semantic change to existing fields. Additive ⇒ non-breaking. Provenance — every bypass is traceable.

**Alternatives rejected:**
- *Bump to v2* — LD5 forbids; v2 reserved for breaking changes.

### D11 — rule_id is immutable hash input (LD-G7)
**Choice:** Document in CONTRIBUTING: rule_ids are immutable. If a rule must be renamed, mint new keys under the new id; old keys are forfeit. Catalog already flags misnamed rules (`block-rm-bd-sub-skills`).

**Why:** YAGNI. `key_aliases` field adds schema complexity for a rare event. Documentation + policy is simpler.

**Alternatives rejected:**
- *key_aliases:[...] field* — schema complexity, dual-key management. Rejected per YAGNI.

## Risks / Trade-offs

- **[Risk] Key in `ps` / shell history via `--unlock`** → mitigate: ENV default for trusted-agent sessions, `--unlock-stdin` for sensitive, document risk in README.
- **[Risk] Decision record leaks full key** → hard rule: only `unlock_key_id` (first 8 hex) is logged. Verified by schema test.
- **[Risk] Salt file world-readable** → `SaltResolver` writes with `mode:0o600` (LD-CA16), warns on read if mode != 0o600.
- **[Risk] Salt race on first-use** → atomic `O_CREAT|O_EXCL` (`fs.writeFileSync(path, salt, {flag:'wx', mode:0o600})`); loser re-reads winner's file.
- **[Risk] LL key leak = valid forever** → accepted per LD-G5. Salt rotation is the sledgehammer. Documented as hard constraint.
- **[Risk] TTL clock manipulation** → accepted per OT13. TTL relies on verifier's clock being honest. Documented threat-model limit. Treat TTL as convenience, not enforcement.
- **[Risk] Unlock filter crash** → LD-G8: try/catch → fall back to un-filtered decision, `source:'unlock-filter-error'`.
- **[Risk] gcloud/bq rules un-unlockable** → LD-G4: scoped out by design. Documented.
- **[Trade-off] We carry the unlock design ourselves vs adopt an external capability framework** → accepted. Ownership of the schema + LD1 is the explicit reason.

## Migration Plan

1. **Implement** `src/unlock/` (6 files), `src/audit/` (1 file), schema additive edits, config + DecisionBuilder + CLI edits.
2. **Test (TDD)** — RED sub-agent writes failing tests first; GREEN sub-agent implements to pass.
3. **No data migration** — additive; existing decisions unchanged (no unlock fields ⇒ consumers treat as absent).
4. **Rollout** — ship as minor bump (0.1.x → 0.2.0). Unlock keys inert unless `PIOPANET_UNLOCK_KEYS` set or `--unlock` passed.
5. **Rollback** — revert to prior tag; salt file is per-invocation, no persisted unlock state to clean up.
6. **Doc update** — README capabilities + new `docs/unlock-keys.md`; CONTRIBUTING rule_id immutability rule.

## Open Questions

- **OQ1:** Should `unlock-key --list` also show *gcloud/bq* rules with a `(out-of-scope)` marker? **Defer** — KISS. `--list` enumerates catalog only.
- **OQ2:** Should we ship a `pi-opa-net unlock-key --rotate-salt` subcommand? **Defer** — user can `rm ~/.pi-opa-net/salt` for now. Add if asked.
