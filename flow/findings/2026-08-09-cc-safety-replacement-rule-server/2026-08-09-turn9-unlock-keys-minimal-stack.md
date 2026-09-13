# Explore Turn 9 — unlock-keys in minimal stack

> Date: 2026-08-09
> Phase: explore mode (ospx step 10) — unlock-keys applicability
> Status: unlocks carry over unchanged; gap = no instant revocation (TTL + salt rotation cover it)

## Conversation

> **[user]** (verbatim — trust chain L1)
> BUT remember that:
> - we are having the feat about: having the override key ;
> 
> how do make that applicable for the current minimal implementation / stack?

### [assistant] — final answer (as-is)

Unlocks carry over **unchanged** — by design the key system was always client-side (LD-L6: keys never enter OPA; TS post-eval filter). Minimal stack loses nothing except instant revocation, and Ansible covers that.

## Mapping to minimal stack

| Unlock-key piece | Minimal stack home | Status |
|---|---|---|
| UnlockFilter (demote deny→allow w/ key) | runs inside client's `common.eval()` — already post-eval, no server needed | ✅ exists verbatim |
| Key format `ll_…` / `ttl.<exp>.…` | unchanged | ✅ exists |
| Delivery ENV `PIOPANET_UNLOCK_KEYS` / `--unlock` | agent session env — identical for pi/hermes/zcode hooks | ✅ exists |
| **Salt** (LD-Y1 deploy-local) | **Ansible deploys salt file to `~/.opa-net/salt`** — `SaltResolver` already reads deploy-local path + env override | ✅ seam exists, just deploy it |
| Issuance | local CLI `pi-opa-net unlock-key <rule-id>` (already in repo). You mint keys, hand to trusted agent sessions | ✅ exists |
| Audit of bypasses | `source:'opa-unlocked'` in decision record → filesystem/OTLP audit | ✅ exists |

## The one gap + its answer

**No server = no instant per-key revocation.** Two levers, both already designed:

1. **TTL keys** — issue short-lived (`ttl.<exp>.…`). Damage window = TTL, auto-expires. Use these by default for agent grants.
2. **Salt rotation** — Ansible redeploys new salt → ALL derived keys die instantly (LD-L2: no god-key, per-rule derivation). Nuclear, but it's a one-command fleet-wide kill switch.

Trade: LL keys become awkward (rotation invalidates them), TTL keys become the norm. For a trusted fleet of your own agents — fine.

## Net

```
~/.opa-net/           ← Ansible-deployed
├── rules/…rego
├── digest / version
└── salt              ← LD-Y1 deploy-local salt lives here

client hook: load → eval (UnlockFilter runs inside) → allow/gate
agent env:   PIOPANET_UNLOCK_KEYS=ttl.<exp>.<hex>   ← minted per grant
revoke:      default = wait TTL · urgent = ansible salt rotate
```

Zero new code for the feature itself; only task = make the Ansible role carry the salt file (mode 600, per-host).

That's the full picture — turns 6–8 (polarity lock, 3-component, minimal single-hook + unlocks) are all uncaptured in the findings dir. Want me to persist them now before you exit explore?

## Status at end of turn 9

Unlock-keys fully mapped to minimal stack. No new code needed. Fleet-wide kill switch = salt rotation. Explore complete — ready to exit and start `/opsx:new`.
