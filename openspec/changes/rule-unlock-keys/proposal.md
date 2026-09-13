## Why

pi-opa-net today cannot express "very specific trusted agents bypass a specific deny rule." Every deny is absolute — there is no per-rule escape hatch. The user wants to grant a *capability* (not a config flag): a key, derived from the rule_id, that an agent holds and presents to bypass exactly that rule. Without this, every trusted-agent automation must either run unguarded or wait for a policy redeploy.

This is the second capability cc-safety-net could never express (token-OR matcher has no per-rule secret), and the wall pi-opa-net was built to cross. Resolving it here lets every future "let this one agent do this one thing" come for free, and validates the TS-side post-eval filter pattern as the unlock extension point.

## What Changes

- **Add an unlock-key capability layer** — `src/unlock/` module: `KeyDerivation` (HMAC-SHA256(salt, rule_id) → 16 hex), `KeyParser` (`ll_<16hex>` | `ttl.<exp>.<16hex>`), `KeyVerifier` (valid / wrong-rule / expired / wrong-salt), `UnlockFilter` (post-eval filter that demotes bypassed reasons), `SaltResolver` (deploy-local `~/.pi-opa-net/salt` + env override seam).
- **Add an audit seam** — `src/audit/AuditSink.ts`: interface + `NoOpSink` default. Future `FileAppendSink` / `WebhookSink` are config-only additions.
- **Two key types** — long-lived (`ll_<16hex>`) and TTL (`ttl.<unix-exp>.<16hex>`). Self-describing prefix, no server-side state for expiry.
- **Granularity = per-rule** (LD-L1). One key unlocks ALL commands that fire that rule. No per-command or per-arg variants.
- **No god-key** (LD-L2). `PIOPANET_UNLOCK_ALL` is refused.
- **Three delivery channels** (LD-L4): `PIOPANET_UNLOCK_KEYS` env (comma-separated), `--unlock <key>` CLI arg, `--unlock-stdin` (requires positional command arg — LD-G2).
- **Location = TS-side post-eval filter** (LD-L6). Policy file `safety.rego` is UNCHANGED. Keys never enter OPA input or trace.
- **Schema additive, stays v1** — new `source: 'opa-unlocked'` enum value, `reasons[].bypassed`, `reasons[].unlock_key_id` (first 8 hex, NEVER full key), `reasons[].unlock_key_type`, optional `reasons[].unlock_expires_at`, `metadata.unlock_count`, `metadata.unlock_blocked_count`, `metadata.unlock_agent`. New fail-mode enum values `fail-open-keyless` (LD-G1), `unlock-filter-error` (LD-G8).
- **Filter crash fail-mode** (LD-G8): unlock filter wrapped in try/catch; on throw, fall back to UN-FILTERED engine decision (if OPA said deny, stay deny — never allow-by-accident). Logged as `source:'unlock-filter-error'`.
- **Cache poisoning guard** (LD-G3): when any unlock keys are present, `cacheTtlMs` is forced to 0.
- **All-or-nothing semantics** (LD-G6): allow ⟺ every severity-block reason has a matching valid key. Partial bypass is forbidden.
- **New CLI subcommand** `pi-opa-net unlock-key <rule_id> [--ttl <sec>]` to mint keys, plus `pi-opa-net unlock-key --list` to enumerate catalog-registered rule_ids (gcloud/bq out-of-scope — LD-G4).
- **rule_id immutability** (LD-G7): documented as hard constraint in CONTRIBUTING.

**Non-goals (v1):**
- No single-use / per-command keys (K3 dropped — LD-L1).
- No god-key (LD-L2).
- No revocation list (LD-G5). Salt rotation is the only LL revocation mechanism.
- No gcloud/bq rule unlock (LD-G4 — they have no canonical rule_id).
- No pi-extension wiring (still OT5 — separate `pi-opa-net-ext` repo).
- No persistent audit log file (LD-Y2 — decision record + NoOp sink seam only).
- No remote/keychain salt fetcher (LD-Y1 — file + env only; SaltResolver interface for future).

## Capabilities

### New Capabilities
- `rule-unlock-keys`: Capability-based per-rule bypass. Agent presents a salted HMAC key derived from rule_id; unlock filter demotes matching deny reasons post-evaluation. Two key lifetimes (long-lived, TTL). All-or-nothing multi-rule semantics. Schema records every bypass with truncated `unlock_key_id` + mandatory `source:'opa-unlocked'`.

### Modified Capabilities
- `decision-output-v1`: Additive fields (`reasons[].bypassed`, `unlock_*`, `metadata.unlock_*`), new `source` enum values (`opa-unlocked`, `fail-open-keyless`, `unlock-filter-error`). No field removed, no semantic change to existing fields. Stays v1.

## Impact

- **Code:** new `src/unlock/` (6 files), new `src/audit/` (1 file), edits to `src/output/DecisionBuilder.ts`, `src/output/OutputFormatter.ts`, `src/cli/run.ts`, `src/config/Config.ts`, `src/rules/catalog.ts` (no change — rule_id already correct as hash input).
- **Schema:** `schemas/decision-output.v1.json` gains additive fields + enum values. No bump (LD5: v1 reserved for breaking changes only).
- **Policy:** `policy/safety.rego` UNCHANGED. Unlock lives TS-side.
- **API:** new public exports `KeyDerivation`, `KeyParser`, `KeyVerifier`, `UnlockFilter`, `SaltResolver`, `AuditSink`, `NoOpSink`. CLI gains `unlock-key` subcommand + `--unlock` / `--unlock-stdin` flags.
- **Dependencies:** none new (Node `crypto.createHmac`, `fs.writeFileSync mode:0o600`, already dependency-free pattern).
- **Tests:** new `tests/unit/unlock/` (5 files), new `tests/unit/audit/NoOpSink.test.ts`, new `tests/e2e/unlock-flow.test.ts`, schema-validation tests for new fields, fail-mode tests for `unlock-filter-error` + `fail-open-keyless`, cache-poisoning regression test.
- **Docs:** README "Capabilities" + `docs/unlock-keys.md` describing key minting, delivery, threat model, salt rotation, rule_id immutability. CONTRIBUTING gains "rule_id is immutable hash input" rule (LD-G7). Threat-model limit for TTL clock manipulation documented (LD-G6/OT13).
- **Tracked threads:** closes OT1 (this proposal capture). All 16 explore open threads now resolved (8 auto-decided LD-G1..G8, 6 implementation tasks, 2 escalated).
