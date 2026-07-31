# Appendix to Turn 2 — unlock design gotchas (batch A)

> Gotcha coverage for: Turn 2 (./2026-07-20-turn2-explore-unlock-design-forks.md)
> Sub-agent: reviewer (batch A)
> Items reviewed: LD-L1, LD-L2, LD-L3, LD-L4, LD-L6
> Source: `.pi-subagents/artifacts/outputs/99e702dc.../solutions/batch-a-gotchas.md`

---

## Findings (ranked)

### Rank 5 (Sophisticated)

- **Multiple rules fire on one command → need ALL keys; partial-unlock state undefined**
  - What: A single command can be denied by MORE than one rule. K1 per-rule means each fired rule needs its OWN key. If the agent holds a key for rule A but not rule B, the command stays blocked — but the schema delta has no way to express "1 of 2 reasons bypassed." The post-eval filter must decide: allow only when ALL blocking reasons are unlocked, else deny.
  - Why missed: Original forks framed granularity as "what does ONE key unlock," never "how many keys does ONE command need."
  - Severity: Undefined output state → either silent partial-bypass (security hole) or confusing UX.
  - Mitigation: Define filter semantics as "allow ⟺ every `severity:block` reason has a matching valid key." Add `reasons[].bypassed` per-entry and emit `metadata.unlock_count` + `unlock_blocked_count`.

- **fail-open (OPA down) is already a KEYLESS universal bypass — "no god-key" is undermined**
  - What: LD-L6 puts the unlock check in a TS post-eval filter that runs ONLY when OPA returns reasons. `src/config/Config.ts` defaults `failMode='open'`. When OPA is down: allow + empty reasons → unlock filter has nothing to filter → command allowed with NO `source:opa-unlocked` audit trail. An attacker who can induce OPA unavailability bypasses EVERY rule lock without any key.
  - Why missed: CA6 framed fail-open interaction as benign — true mechanically, false for the threat model.
  - Severity: A motivated attacker (or flaky OPA) turns the whole key system into a no-op.
  - Mitigation: When ANY unlock key is configured, the engine SHOULD fail-closed on OPA outage. Add `source:'fail-open-keyless'` distinct from plain `fail-open`.

- **`--unlock-stdin` DOUBLE-READS fd 0 — conflicts with existing command-via-stdin path**
  - What: `src/cli/run.ts` `resolveRaw()` ALREADY reads stdin (fd 0) when no positional command is given. LD-L4 adds `--unlock-stdin` which ALSO reads stdin. You cannot read fd 0 twice — the second read gets EOF/empty.
  - Why missed: The unlock design was authored without re-reading `run.ts`'s stdin contract.
  - Severity: Implementation blocker. `--unlock-stdin` as specified cannot coexist with command-via-stdin.
  - Mitigation: Pick one: (a) `--unlock-stdin` requires a positional command arg, or (b) keys read from a different fd, or (c) introduce `--command-stdin` vs `--key-stdin` explicit flags.

- **Cache poisoning — cache key must include the unlock-set**
  - What: `src/engine/types.ts` declares `source:'cached'` and `src/config/Config.ts` declares `cacheTtlMs`. When caching is enabled, the cache is almost certainly keyed on the parsed command. Agent A runs `git stash pop` WITH key X → allow → CACHED. Agent B runs same command WITHOUT key → cache HIT → allow with NO key. Key-bypass-via-cache.
  - Why missed: The unlock design assumed a stateless post-eval filter; the cache seam was not on the analysis radar.
  - Severity: If cache ships without addressing this, ANY keyed-allow poisons the cache for all future callers.
  - Mitigation: Cache key MUST include a hash of the resolved unlock-key-set, OR force `cacheTtlMs=0` when any unlock keys are present.

### Rank 4 (Significant)

- **gcloud / bq rules CANNOT be unlocked — no enumerable rule_id**
  - What: K1 derives the key from `HMAC(salt, rule_id)`. But `src/rules/catalog.ts` RULES array has NO entries for gcloud or bq. `RuleRegistry.lookup` synthesizes `custom:<hash(message)>` where the hash depends on the substituted verb. That synthesized id is not enumerable by `pi-opa-net unlock-key --list`, different per verb, and NOT what a user can mint. Result: the entire gcloud + bq deny families are effectively UN-UNLOCKABLE under LD-L1+LD-L6.
  - Why missed: Original findings treated "rule_id is hash input" as universally true without checking that gcloud/bq have no stable rule_id.
  - Severity: Whole rule families silently outside the unlock system.
  - Mitigation: Either register gcloud/bq as discrete `RuleMeta` entries, OR scope the unlock feature to catalog-registered rules and document gcloud/bq as out-of-scope.

- **rule_id mutability invalidates all minted keys — no migration story**
  - What: Key = `HMAC(salt, rule_id)`. rule_id is treated as immutable, but the catalog ALREADY documents drift: `block-rm-bd-sub-skills` and `block-rm-beads-subdirs` are flagged "rule is misnamed 'allow'". A routine rename would silently invalidate every key ever minted for the old id.
  - Why missed: Original analysis assumed rule_ids are stable hash inputs without auditing the catalog's own "misnamed" notes.
  - Severity: A routine rename PR bricks the deployed keychain with no error.
  - Mitigation: Treat rule_id as a versioned identifier (forbid renames in CONTRIBUTING, or carry a `key_aliases: [...]` field).

- **NO revocation for long-lived keys — leaked `ll_` key is valid forever**
  - What: LL keys have NO embedded expiry and NO server-side revocation list. A leaked `ll_<16hex>` is valid until the salt rotates — and rotating the salt is expensive and kills ALL keys. There is no way to revoke a SINGLE compromised LL key.
  - Why missed: The turn3 TTL design focused on "how do keys expire" and never asked "how do LL keys get killed."
  - Severity: A single leaked LL key is a permanent rule-wide bypass.
  - Mitigation: Either accept "salt rotation is the only LL revocation" and document it, OR add a minimal revocation list seam (`~/.pi-opa-net/revoked.txt`).

- **TTL key is replayable-within-window — conflates "temporary" with "single-use"**
  - What: A `ttl.<exp>.<mac>` key is valid for EVERY invocation until `exp`. Dropping K3 removed the only single-use primitive. So `--ttl 3600` is "unlock this rule for 1 hour of UNLIMITED use," not "unlock one command."
  - Why missed: TTL was designed as the "temporary" alternative to LL; the distinction "temporary ≠ single-use" was never made explicit.
  - Severity: Mis-matched user mental model → over-broad capability granted.
  - Mitigation: Document clearly: "TTL = time-bounded unlimited use within the window; there is no single-use mode."

- **Clock manipulation makes TTL keys effectively permanent — no trusted time anchor**
  - What: TTL verification is `now > exp` where `now = Date.now()` on the verifier's process clock. A verifier that freezes/rewinds its clock keeps `now < exp` forever → a TTL key becomes permanently valid. The "no server-side state" decision removes the only anchor that would resist this.
  - Why missed: CA9 framed clock as a skew problem, not an adversarial-control problem.
  - Severity: An agent that controls its own clock defeats TTL entirely.
  - Mitigation: State the threat-model limit explicitly: "TTL relies on the verifier's clock being honest; treat TTL as convenience, not enforcement, against a compromised agent."

- **TS-filter crash has NO fail-mode — undefined behavior**
  - What: The TS-side unlock filter has NO equivalent fail-mode. If the filter throws, the whole `runCli` pipeline throws → the bin wrapper's behavior is undefined.
  - Why missed: Fail-mode was scoped to the OPA engine only; the new TS stage inherited no fail-mode contract.
  - Severity: A parser bug in the unlock path takes down command evaluation with no defined fallback.
  - Mitigation: Wrap the unlock filter in try/catch: on filter error, fall back to the UN-FILTERED engine decision (if OPA said deny, stay deny; never allow-by-accident).

- **Post-eval filter keys off registry-LOOKED-UP rule_id, not the canonical one**
  - What: Pipeline order: engine returns raw deny messages → `buildReasons` calls `registry.lookup` → produces `rule_id` (possibly `custom:<hash>` for unregistered rules) → the unlock filter would key off THAT. For gcloud/bq, the filter's rule_id is the synthesized `custom:<hash>` which no user can mint a key for.
  - Why missed: The "three halves" diagram glossed over whether the filter is before or after the registry lookup.
  - Severity: Whole rule families un-unlockable; refactor-fragile.
  - Mitigation: Specify the filter operates on the registry-RESOLVED rule_id, and that key derivation MUST use the same resolved id.

- **Multi-channel merge semantics undefined**
  - What: An agent can simultaneously set `PIOPANET_UNLOCK_KEYS=ll_a` AND pass `--unlock ll_b` AND pipe `ll_c` via stdin. LD-L4 lists three channels but never defines merge: union, last-wins, or intersection.
  - Why missed: Each channel was justified independently; their interaction was never modeled.
  - Severity: An agent that intends "override env with a narrower key" may get "union of both."
  - Mitigation: Specify UNION as the semantics and document.

### Rank 3 (Moderate)

- **Dropping K3 widens blast radius of any leaked ENV key**
  - What: LD-L1 drops `--unlock-once`. Combined with LD-L4 ENV delivery and LD-L3 TTL, there is now NO single-use primitive. A key in `PIOPANET_UNLOCK_KEYS` is valid for UNLIMITED invocations of ANY command firing that rule, for the whole session (LL) or until exp (TTL).
  - Why missed: LD-L1 was locked in isolation from LD-L4's persistence model.
  - Severity: Credential leak → indefinite rule-wide bypass until salt rotation.
  - Mitigation: Accept as a documented limitation, OR add a lightweight per-key nonce/counter as a future seam.

- **Functional god-key achievable by composition — no cap**
  - What: Refusing a NAMED `PIOPANET_UNLOCK_ALL` does not prevent an operator minting all ~40 per-rule keys and dumping them comma-separated into `PIOPANET_UNLOCK_KEYS`. The result is functionally a god-key.
  - Why missed: The decision was scoped to "should we ship a god-key token," not "can a god-key be assembled."
  - Severity: An auditor cannot distinguish "scoped agent" from "agent with every key" from the decision record alone.
  - Mitigation: Optional — warn when `PIOPANET_UNLOCK_KEYS` count exceeds a threshold, or emit `metadata.unlock_keys_provided` count.

- **No bulk re-mint — routine salt rotation is operationally expensive**
  - What: HMAC salt rotation is recommended hygiene, but with no god-key there is no bulk path. Rotating salt = every per-rule key dies = operator must re-mint each one individually.
  - Why missed: Rotation operability was never on the question list.
  - Severity: Operators will avoid rotating salt → stale salt → weaker posture over time.
  - Mitigation: Ship an inventory file (`~/.pi-opa-net/key-inventory.json`) listing which rule_ids have been minted, so `unlock-key --reissue-all` can re-mint the same set under a new salt.

- **`exp` minted from a wrong/broken minter clock**
  - What: The minter is `pi-opa-net unlock-key <rule> --ttl N` running on the USER's box. If that box's clock is wrong, exp is computed wrong.
  - Why missed: Only the verifier clock was considered, not the minter clock.
  - Severity: User mints a key that doesn't behave as expected.
  - Mitigation: Minter sanity-checks: warn if `exp` is implausible, reject negative `--ttl`. Print the computed absolute exp time to the user at mint.

- **No MAX_TTL cap — a far-future exp is a permanent key wearing a TTL costume**
  - What: `--ttl 999999999` (≈31 years) produces a `ttl.<year-2057>.<mac>` that is functionally a long-lived key but logged/audited as `unlock_key_type:'ttl'`.
  - Why missed: TTL bounds were never specified.
  - Severity: Audit/reports that count TTL vs LL usage become unreliable.
  - Mitigation: Define MAX_TTL (e.g. 7 or 30 days). Reject `--ttl` above it.

- **Key format/delimiter for `PIOPANET_UNLOCK_KEYS` unspecified**
  - What: LD-L4 says keys come via env, but the SEPARATOR between multiple keys is undefined.
  - Why missed: Delivery channels were listed; their multi-value grammar was not.
  - Severity: Interop — two wrappers using different delimiters silently drop keys.
  - Mitigation: Specify: `PIOPANET_UNLOCK_KEYS` is comma-separated; `--unlock` repeatable; union all channels; ignore empty tokens.

- **ENV keys propagate to ALL child processes**
  - What: `PIOPANET_UNLOCK_KEYS` in env is inherited by EVERY child the agent spawns — including untrusted ones.
  - Why missed: CA1 compared ENV vs `--unlock` on the PERSISTENCE axis, not the INHERITANCE axis.
  - Severity: Any untrusted subprocess of a keyed agent silently receives the full keychain.
  - Mitigation: Document explicitly: "ENV keys are visible to all descendant processes; for untrusted-child scenarios use `--unlock-stdin` or a per-call `--unlock`."

- **`--unlock-stdin` empty/closed behavior undefined**
  - What: If `--unlock-stdin` is passed but stdin is empty, the parser receives `""`. Empty string is not a valid key. Is it a loud error, a silent skip, or a no-op?
  - Why missed: Failure modes were specified for EXPIRED keys but not for MISSING/EMPTY stdin.
  - Severity: Silent no-op → user believes key was applied, command still blocked.
  - Mitigation: `--unlock-stdin` with empty stdin = loud error.

- **Policy can NEVER branch on unlock possession**
  - What: Because the key never enters OPA input, the rego policy CANNOT express "block X for agents without a key, allow-with-warning for agents with a key" at the policy layer.
  - Why missed: LD-L6 was framed purely as a benefit.
  - Severity: YAGNI now, but a real ceiling if the product evolves toward tiered policy.
  - Mitigation: Document as an explicit design ceiling.

### Rank 2 (Minor)

- **`builtin:bare-stash-default` rule_id contains a colon — parsing surfaces**
  - What: The colon is unusual. Some shell-quoting / arg-parsing libraries treat `:` specially.
  - Why missed: Colon rule_ids exist but were never run through the mint/verify CLI in the design.
  - Severity: Cosmetic / parser-fragility.
  - Mitigation: Unit-test mint+verify round-trip for `builtin:` and `custom:` ids explicitly.

- **`unlock_key_id` is NOT stable across LL vs TTL for the same rule**
  - What: LL mac = `HMAC(salt, rule_id)`; TTL mac = `HMAC(salt, rule_id + str(exp))` → DIFFERENT macs → DIFFERENT key_ids for the same rule.
  - Why missed: key_id was designed as a key-truncation without considering cross-type stability.
  - Severity: Minor — misleading audit field.
  - Mitigation: Add `unlock_rule_id` to the bypassed reason alongside `unlock_key_id`.

- **Salt FILE FORMAT unspecified**
  - What: `HMAC(salt, rule_id)` — is `salt` the raw file bytes, the trimmed string, base64-decoded, or hex-decoded? If the salt file is written with a trailing `\n` and read by another that doesn't trim, the HMAC key differs.
  - Why missed: Salt was treated as "a secret blob," format unspecified.
  - Severity: Cross-machine / cross-tool key failure with no diagnosable error.
  - Mitigation: Define salt format: first line of file, UTF-8, trailing newline STRIPPED, OR base64 of N random bytes.

- **Salt file permissions not specified**
  - What: If `~/.pi-opa-net/salt` is created 0644, any local user reads it → forges every key.
  - Why missed: Salt was discussed as location and loss, never as permissions.
  - Severity: Local-privilege-escalation to full keychain forgery on multi-user boxes.
  - Mitigation: Create salt with mode 0600; refuse to load if permissions are looser.

- **exp parsing edge cases**
  - What: `ttl.<exp>.<mac>` parser must reject: `ttl..mac`, `ttl.-1.mac`, `ttl.abc.mac`, `ttl.01753.mac`, `ttl.1753.1234.mac`.
  - Why missed: KeyParser was enumerated as a module but its rejection grammar was never specified.
  - Severity: A malformed-key parser bug could accept a forged mac.
  - Mitigation: Define strict grammar: `^ll_[0-9a-f]{16}$` | `^ttl\.\d{1,10}\.[0-9a-f]{16}$`.

- **Stale key (valid mac, rule no longer exists) is silent**
  - What: A key whose mac is valid for a rule_id that was DELETED/RENAMED produces no deny to filter — it silently matches nothing.
  - Why missed: Expiry was the only "dead key" case considered; structural staleness was not.
  - Severity: User confusion + masks the LD-L1 rename-bricking bug.
  - Mitigation: At startup, for each provided key, if its derived rule_id is not in the current catalog, emit a stderr warning.

- **ENV var size limits + no file-delivery escape hatch**
  - What: LD-L4 closes the door on file-based delivery. ENV has platform limits. With many keys, ENV can approach limits.
  - Why missed: YAGNI closed the channel without sizing the alternative.
  - Severity: Edge-case failure at high key counts.
  - Mitigation: Low priority — note the limit, leave `PIOPANET_UNLOCK_KEYS_FILE` as a documented future seam.

- **No salt/scheme provenance in the audit record**
  - What: The schema delta does NOT add `unlock_salt_digest` or `unlock_scheme_version`. After a salt rotation, old records are unverifiable.
  - Why missed: Provenance was added per-key but not per-salt.
  - Severity: Audit gap — cannot prove a past unlock was valid under the then-current salt.
  - Mitigation: Add `metadata.unlock_salt_digest` (SHA-8 of the salt) to the decision record.

- **`source:'opa-unlocked'` collides conceptually with `source:'cached'`**
  - What: If caching is enabled AND a previously-unlocked decision is replayed from cache, what is `source`?
  - Why missed: `cached` and `opa-unlocked` were designed independently.
  - Severity: Either audit loses unlock info or audit lies about freshness.
  - Mitigation: Either forbid caching unlocked decisions, or add `source:'cached-unlocked'`.

---

## Cross-decision interaction summary

| Interaction | Effect | Refs |
|---|---|---|
| LD-L2 × LD-L6 | fail-open = keyless universal bypass on OPA outage | LD-L2 Rank 5 |
| LD-L4 × LD-L6 | `--unlock-stdin` double-reads fd 0 vs command-via-stdin | LD-L4 Rank 5 |
| LD-L6 × cache seam | cache poisons across key-sets | LD-L6 Rank 5 |
| LD-L1 × LD-L6 | gcloud/bq un-unlockable (no canonical rule_id at filter) | LD-L1 Rank 4, LD-L6 Rank 4 |
| LD-L1 × LD-L3 | no one-shot; TTL is replayable-within-window | LD-L1 Rank 3, LD-L3 Rank 4 |
| LD-L3 × LD-L6 | TTL relies on verifier clock (no trusted anchor) | LD-L3 Rank 4 |
| LD-L2 × LD-L3 | no single-key revocation; salt rotation is blunt | LD-L2 Rank 3, LD-L3 Rank 4 |

---

## Top 5 to fix before implementation

1. **LD-L2/L6 fail-open = keyless god-bypass** (Rank 5) — fail-closed when keys present, or document the degradation loudly.
2. **LD-L4 `--unlock-stdin` fd 0 conflict** (Rank 5) — pick a resolution rule; blocks implementation.
3. **LD-L6 cache poisoning** (Rank 5) — cache key must include unlock-set hash; force cacheTtlMs=0 with keys.
4. **LD-L1/L6 gcloud+bq un-unlockable** (Rank 4) — catalog them or scope them out explicitly.
5. **LD-L3 no LL revocation** (Rank 4) — decide: salt-rotation-only (documented) or revocation-list seam.

---

## Cross-turn references

- Also relevant to: Turn 3 §TTL design, Turn 4 §ship surface
