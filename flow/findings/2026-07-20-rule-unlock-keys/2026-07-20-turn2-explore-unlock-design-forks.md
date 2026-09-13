# Explore Turn 2 — unlock-keys design forks

> Date: 2026-07-20
> Phase: explore (kickoff under `/opsx:explore`)
> Status: complete — four design forks mapped, 7 open questions surfaced

---

## [user]

> **[user]** (verbatim — trust chain L1):
>
> Make the kind of hidden bypass / hidden unlock functionalities , sometimes some VERY specific agent will have capability of bypass some rules ; But they must have some kind of unlock key: Key is either be set via: ENV , addition args; Note that these are like generated from the hash of the rules and it is like password , only user have it , user will provide to the agent if they want to;

---

> **[note]** `/opsx:explore` cmd invoked (family ospx, step 10/70). The cmd expanded into the explore-mode preamble governing assistant stance: curious-not-prescriptive, visualize freely, no implementation (explore = thinking), OpenSpec-aware. Full preamble lives in `~/.pi/agent/cmd-family/ospx.yml`. Only user-typed text reproduced above; cmd boilerplate not duplicated.

---

## [assistant]

In explore mode — thinking, not implementing. Read the codebase + the in-flight `conditional-branch-gate` design to ground this.

### What I read

```
[E1] src/util/digest.ts ............ sha256Prefix(file) — drift detection, 12 hex chars
[E2] src/output/DecisionBuilder.ts . owns schema assembly; reasons→rule_id lookup; severity='block'
[E3] src/cli/run.ts ................ parse → engine.evaluate → builder.build → validate → emit
[E4] policy/safety.rego ............ deny[msg] blocks; default allow=true (fail-open)
[E5] openspec/changes/conditional-branch-gate/proposal.md ... adds input.signals.* — sibling pattern to copy
```

### The shape of the problem

```
                ┌─────────────────────────────────────────┐
                │  USER (sole keychain holder)            │
                │                                         │
                │   pi-opa-net unlock-keys                │
                │   ┌────────────────────────────────┐    │
                │   │ block-git-stash-mutations      │    │
                │   │   ↳ a3f9c2b8e1d4...            │    │  ← HMAC(salt, rule_id)
                │   │ block-git-reset-hard           │    │
                │   │   ↳ 7c2f8a1b...                │    │
                │   └────────────────────────────────┘    │
                └──────────────┬──────────────────────────┘
                               │ user hands specific key(s)
                               │ to a trusted agent's env
                               ▼
                ┌──────────────────────────────────────────┐
                │  AGENT (possesses key = capability)       │
                │  PIOPANET_UNLOCK_KEYS=a3f9c2b8e1d4,...    │
                │  (or: --unlock a3f9... per invoke)        │
                └──────────────┬───────────────────────────┘
                               │ agent runs `git stash pop`
                               ▼
   ┌─────────┬─────────┬─────────────┬───────────┐
   │  PARSE  │ EVAL    │ UNLOCK      │  EMIT     │
   │ tokens  │ rego    │ filter (TS) │  schema   │
   └─────────┴─────────┴─────┬───────┴───────────┘
                             │ for each deny reason:
                             │   key = HMAC(salt, rule_id)
                             │   if key ∈ unlock_set:
                             │     demote severity→info, bypassed=true
                             │     drop from blocking set
                             ▼
   decision: allow
   source:   opa-unlocked   ← distinct, greppable
   reasons:  [{...,bypassed:true, unlock_key_id:"a3f9c2b8"}]
```

Possession of key = capability. No separate agent allowlist needed — user only hands keys to agents they trust.

### Four design forks

#### Fork 1 — Granularity (what does one key unlock?)

| Flavor | Hash input | Specificity | My lean |
|--------|-----------|-------------|---------|
| K1 per-rule | `rule_id` | unlocks rule for ANY cmd | **default** |
| K2 per-rule+args | `rule_id + sorted(block_args)` | unlocks only matching arg pattern | optional |
| K3 per-command | `rule_id + raw_command` | unlocks that exact cmd, once | `--unlock-once` for sensitive ops |

K1 simplest. K3 most surgical (good for "let this agent run this one `git push --delete` then revoke"). Ship K1 default + K3 escape hatch.

#### Fork 2 — Key derivation (what's hashed + salt?)

Bare `sha256(rule_id)` is brute-forceable: rule_ids are public (`tests/fixtures/user-rules.rulebook.json` ships them). Anyone can pre-compute the whole keychain → security theater.

```
 WITHOUT salt                    WITH per-deploy salt
 ──────────────────              ─────────────────────
 key = sha256(rule_id)           key = HMAC-SHA256(salt, rule_id)
                                   .hex().slice(0,16)
 keys are GLOBAL                 keys are DEPLOYMENT-SPECIFIC
 publishable rainbow table       machine A's key ≠ machine B's
 security theater                real shared secret
```

**Lean: salted.** Salt generated once at install, stored `~/.pi-opa-net/salt` (or `PIOPANET_UNLOCK_SALT` env). Rotation = new salt = all old keys die. Cheap reset on compromise.

Tradeoff: keys don't transfer across machines. For a single-user multi-box workflow that's a feature; for "share keys with a teammate" it's friction. Resolvable via shared salt file.

#### Fork 3 — Where does the check live? (the interesting fork)

```
 ┌─ Rego-side ──────────────────────┬─ TS-side (post-eval filter) ────────────┐
 │                                  │                                         │
 │ deny[msg] if {                   │ const blocking = engine.reasons.filter( │
 │   ...match...                    │   r => !unlockKeys.has(                  │
 │   not rule_unlocked(rule_id)     │       deriveKey(r.rule_id))              │
 │ }                                │   )                                     │
 │                                  │ );                                      │
 │ rule_unlocked(rid) if {          │
 │   some k in input.unlock_keys    │ ✓ clean two-halves extension            │
 │   k == derived_key(rid)          │ ✓ key never enters OPA input/trace      │
 │ }                                │ ✓ scheme lives in code, easy to rotate  │
 │                                  │ ✓ fail-open independent                 │
 │ ✗ OPA crypto builtins limited    │                                         │
 │ ✗ key comparison in policy       │                                         │
 │ ✗ scheme change = policy edit    │                                         │
 │ ✗ key visible in OPA trace       │                                         │
 └──────────────────────────────────┴─────────────────────────────────────────┘
```

**Lean: hard toward TS-side.** Maps to existing two-halves architecture → becomes three halves (parse / decide / unlock). Key stays out of policy bundle, out of OPA traces, out of any future OPA debug dump.

#### Fork 4 — Delivery (ENV vs CLI arg vs both)

```
 ┌─ ENV ────────────────────────────┬─ CLI arg ──────────────────────────┐
 │ PIOPANET_UNLOCK_KEYS=a3f9,7c2f   │ pi-opa-net eval "git stash pop" \  │
 │                                  │   --unlock a3f9                   │
 │ ✓ session-scoped, survives       │ ✓ per-invocation, surgical        │
 │ ✓ doesn't leak to ps/history     │ ✗ LEAKS to ps, history, /proc     │
 │ ✗ lingers in env (rotation pain) │ ✓ burns after one use             │
 └──────────────────────────────────┴───────────────────────────────────┘
```

**Lean: both.** ENV as default for trusted-agent sessions; `--unlock` for one-shot. Plus `--unlock-stdin` (read key from stdin) for high-security — never appears in `ps`.

Add `PIOPANET_AGENT_ID` so the decision record can name *who* unlocked (audit, not auth).

### Schema delta (additive, stays v1)

```jsonc
{
  "decision": "allow",
  "source": "opa-unlocked",          // ← NEW enum value
  "reasons": [{
    "rule_id": "block-git-stash-mutations",
    "severity": "info",              // demoted from 'block'
    "bypassed": true,                // ← NEW
    "unlock_key_id": "a3f9c2b8"      // ← first 8 chars only, NEVER full key
  }],
  "metadata": {
    "unlock_count": 1,               // ← NEW
    "unlock_agent": "deploy-bot-7"   // ← NEW (from PIOPANET_AGENT_ID)
  }
}
```

`source: 'opa-unlocked'` is the headline — distinct from `opa` / `fail-open` / `cached`. One grep finds every bypass ever.

### CA — failure modes I want on the table

- `[CA1]` **Key in `ps`/shell history** — `--unlock abc123` is visible to anyone on the box. Mitigation: ENV default, `--unlock-stdin` for sensitive, document risk.
- `[CA2]` **Decision record logging the full key** — must log `key_id` (truncated) only. Never the raw key. Hard rule.
- `[CA3]` **Silent bypass** — without `source:opa-unlocked` + `reasons[].bypassed`, an unlock is invisible. That's a security hole, not a feature. Schema delta is mandatory, not optional.
- `[CA4]` **God-key temptation** — someone will ask for one key that unlocks everything. Default NO. If shipped: `PIOPANET_UNLOCK_ALL=<separately-salted>`, logged LOUDLY (`source:opa-unlocked-admin`).
- `[CA5]` **Salt loss = total reset** — if `~/.pi-opa-net/salt` is deleted, every key ever issued dies. Backup story needed (or accept as security feature).
- `[CA6]` **Fail-open interaction** — unlock filter runs AFTER OPA. If OPA is down (`source:fail-open`), there's nothing to unlock; behavior unchanged. Verified compatible.
- `[CA7]` **Rainbow table without salt** — bare `sha256(rule_id)` is publishable. Salt is not optional in my view (see Fork 2).
- `[CA8]` **Key reuse across rules** — if two rules hash-collide (truncated to 8 chars), one key unlocks both. Use full 16 hex (64 bits) → collision ~1 in 10^19. Acceptable.

### How this fits alongside in-flight work

```
 conditional-branch-gate (in-flight) ──adds──▶ input.signals.*
 rule-unlock-keys       (this)        ──adds──▶ post-eval unlock filter
                                               + source:opa-unlocked
                                               + reasons[].bypassed
```

No conflict. Both additive. Could even ship in either order.

### Open questions for you

```
[Q1] Granularity: K1 (per-rule, default) + K3 (per-cmd --unlock-once)?  Or K2 (per-rule+args) too?
[Q2] Salt: deploy-local (my lean, keys don't transfer) or global (shareable, weaker)?
[Q3] Location: TS-side filter (my lean) — agree?
[Q4] Delivery: ENV + --unlock + --unlock-stdin?  Anything else?
[Q5] God-key: ship PIOPANET_UNLOCK_ALL or refuse?
[Q6] TTL: should keys expire (e.g. PIOPANET_UNLOCK_TTL=3600) or be password-like (long-lived)?
[Q7] Audit sink: just decision record, or also append to ~/.pi-opa-net/unlock.log?
```

### My recommendation in one line

**TS-side post-eval filter, HMAC(salt, rule_id) → 16 hex, ENV+CLI delivery, mandatory `source:opa-unlocked` audit, no god-key, ship K1+K3 granularity.**

---

**Remaining steps (per ospx manifest, step 10):** I don't have direct access to `~/.pi/agent/cmd-family/ospx.yml` to enumerate steps 11–70. Want me to read it and list the remaining steps, or is this exploration step 10 sufficient for now?

---

## Status at end of turn 2

- Four design forks mapped (granularity / derivation / location / delivery).
- Leans stated: K1+K3, salted, TS-side, ENV+CLI.
- 7 open questions [Q1]–[Q7] surfaced for user to lock.
- CA1–CA8 failure modes on record.

→ Continue to `2026-07-20-turn3-lock-decisions-ttl.md`
