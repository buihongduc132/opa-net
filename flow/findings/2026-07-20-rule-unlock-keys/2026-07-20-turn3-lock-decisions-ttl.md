# Explore Turn 3 — lock decisions, TTL design

> Date: 2026-07-20
> Phase: decisions (locking granularity, TTL, god-key, delivery)
> Status: complete — 4 decisions locked, 3 open questions remain

---

## [user]

> **[user]** (verbatim — trust chain L1):
>
> No god key: correct ; design 2 approach: TTL and also long-live; Q1: no need unlock-once , key per rule (like git stash , different than git stash push); Q4: no , only these for now.

---

## [assistant]

Locked your answers. Updated design.

### Decisions locked from your answers

```
[D-L1] Granularity (Q1) ────── K1 PER-RULE only. Drop K3 (--unlock-once).
                                Key for block-git-stash-mutations unlocks
                                ALL stash verbs (push/pop/drop/clear/...)
                                under that rule. One rule = one key.

[D-L2] God-key (Q5) ────────── NO. Refuse PIOPANET_UNLOCK_ALL.

[D-L3] TTL (Q6) ────────────── BOTH. Two key types, see below.

[D-L4] Delivery (Q4) ────────  ENV + --unlock + --unlock-stdin. Nothing else.
```

### TTL + long-lived — how both coexist (the interesting part)

Two key TYPES, self-describing via prefix. No server-side state needed for expiry.

```
 TYPE             FORMAT                         DERIVED FROM                LIFETIME
 ──────────────── ────────────────────────────── ─────────────────────────── ─────────────
 long-lived (LL)  ll_<16hex>                     HMAC(salt, rule_id)         forever*
 ttl              ttl.<unix-exp>.<16hex>         HMAC(salt, rule_id + exp)   until exp

 * until salt rotates
```

**Validator pseudocode (TS-side):**
```
parse key → { type, exp?, mac }
  if type == 'll':  expected = HMAC(salt, rule_id)
  if type == 'ttl':
      if now > exp → reject (expired)
      expected = HMAC(salt, rule_id + str(exp))
  if mac != expected → reject
  else → unlock rule_id, record key_type + (exp if ttl)
```

**Why this shape:**
- TTL state lives IN the key, not on disk → no `.unlock-state` file to lose/sync/corrupt
- User mints a TTL key: `pi-opa-net unlock-key block-git-stash-mutations --ttl 3600`
- Long-lived key: `pi-opa-net unlock-key block-git-stash-mutations` (default)
- Same salt, same rule → LL and TTL keys for same rule coexist (agent picks whichever fits the job)

```
  USER mints                          AGENT receives
  ────────────                        ──────────────
  pi-opa-net unlock-key               PIOPANET_UNLOCK_KEYS=ll_a3f9c2b8e1d4...
    block-git-stash-mutations         ttl.1753123456.7c2f8a1b...
    --ttl 3600
    → ttl.1753127056.7c2f8a1b...      (mixed bag: trusted LL + scoped TTL)
```

### Still open (your call)

```
[Q2] SALT location
     ┌─ deploy-local (~/.pi-opa-net/salt) ─────── my LEAN ─┐
     │  ✓ machine-specific keys (compromise isolated)      │
     │  ✗ keys don't transfer across boxes                 │
     └─────────────────────────────────────────────────────┘
     alt: global/shared salt file (transferable, weaker)
     PICK?

[Q3] LOCATION of unlock check
     TS-side post-eval filter (see prior turn)
     → no objection raised, confirming as LOCKED unless you say otherwise.

[Q7] AUDIT sink
     ┌─ decision record only (mandatory source:opa-unlocked) ─┐
     │  ✓ lives in stdout/JSON, hook captures it              │ minimal
     └─────────────────────────────────────────────────────────┘
     alt: + append ~/.pi-opa-net/unlock.log (line per unlock, SIEM-style)
     PICK?
```

### Updated schema delta (additive, v1 stays)

```jsonc
{
  "decision": "allow",
  "source": "opa-unlocked",
  "reasons": [{
    "rule_id": "block-git-stash-mutations",
    "severity": "info",          // demoted
    "bypassed": true,
    "unlock_key_id": "a3f9c2b8",  // first 8 hex of mac, NEVER full key
    "unlock_key_type": "ll"       // 'll' | 'ttl'   ← NEW (from D-L3)
    // if ttl: "unlock_expires_at": "2026-07-20T07:05:34Z"  ← NEW
  }],
  "metadata": {
    "unlock_count": 1,
    "unlock_agent": "deploy-bot-7"
  }
}
```

### Updated CA — new failure modes from TTL

- `[CA9]` **TTL clock skew** — agent clock vs minter clock drift → premature expiry or extended grace. Standard fix: ±60s tolerance, OR rely solely on minter's `exp` (no skew tolerance — strict). Lean strict.
- `[CA10]` **TTL key minted with wrong unit** — `--ttl 3600` meaning seconds vs minutes. Hard rule: TTL is **seconds**, no ambiguity, error on negatives.
- `[CA11]` **Expired TTL still passed in env** — every expired key rejected loudly (not silently). Decision record shows `unlock_key_id` + `unlock_status: "expired"` so audit catches dead-key attempts.

### CLI surface (locked from D-L4)

```
pi-opa-net eval "git stash pop"
pi-opa-net eval "git stash pop" --unlock ll_a3f9c2b8e1d4
echo "ttl.1753127056.7c2f..." | pi-opa-net eval "git stash pop"  # --unlock-stdin

# key minting (NEW subcommand):
pi-opa-net unlock-key <rule_id>                 # → ll_<16hex>, long-lived
pi-opa-net unlock-key <rule_id> --ttl 3600      # → ttl.<exp>.<16hex>
pi-opa-net unlock-key --list                    # enumerate rule_ids (no keys)
```

---

**Pick Q2 + Q7 and I'll capture this as openspec change `rule-unlock-keys/`** (proposal.md + design.md + specs/rule-unlock/spec.md + tasks.md), mirroring `conditional-branch-gate`'s structure. Still explore mode — capturing artifacts is allowed, code is not.

---

## Status at end of turn 3

- 4 decisions locked: [D-L1] K1 per-rule, [D-L2] no god-key, [D-L3] TTL+LL, [D-L4] ENV+CLI.
- TTL design crystallized: self-describing prefix `ll_` / `ttl.<exp>.<mac>`, no server-side state.
- 3 open questions remain: [Q2] salt, [Q3] location (pending confirmation), [Q7] audit.
- Schema delta updated with `unlock_key_type` field.
- CA9–CA11 added for TTL-specific failure modes.

→ Continue to `2026-07-20-turn4-yagni-finalize-seams.md`
