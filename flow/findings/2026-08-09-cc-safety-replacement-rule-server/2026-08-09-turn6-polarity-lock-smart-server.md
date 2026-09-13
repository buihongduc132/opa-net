# Explore Turn 6 — parity/superset + smart-server/dumb-client polarity

> Date: 2026-08-09
> Phase: explore mode (ospx step 10) — architecture polarity check
> Status: answered YES on parity/superset, NO on sketched architecture; Option B proposed

## Conversation

> **[user]** (verbatim — trust chain L1)
> In short , do that plan be able to make parity or superset of cc-safety-net BUT using OPA and using server client approach ?
> 
> ensure SERVER is the smart , client is the dump / bridge only (which later on could be very easy to port to the other language);

### [assistant] — final answer (as-is)

**Yes on parity/superset. But as sketched — NO on smart-server/dumb-client.** The sketched plan (client fetches rego → evals locally) makes the CLIENT smart. Your constraint flips the architecture.

## Parity/superset: already proven

- Deployed v0.6.0: 51 deny rules vs cc-safety-net's 38 → **superset**.
- OPA expresses what cc-safety-net structurally cannot: bare-subcommand match (`git stash` ≡ `git stash push`, repo OT3), `rm -rf` dangerous-target with raw-regex fallback, token sets. → strict superset.

## Architecture: two options

```
OPTION A — sketched (client-fetch, local eval)      [SMART CLIENT]
┌──────────────────────┐         ┌──────────────┐
│ client: parse, fetch│  GET    │ server: dumb  │
│ rego, cache, spawn   │────────▶│ static blob   │
│ opa eval, build out  │         └──────────────┘
└──────────────────────┘
  port cost: OPA + parser + cache + rego ≈ whole engine. NOT portable.

OPTION B — smart server (your constraint)            [DUMB CLIENT]
┌──────────────┐   POST /eval {raw: "git commit..."}   ┌────────────────────┐
│ DUMB client  │ ────────────────────────────────────▶ │ SMART server       │
│ = bridge     │ ◀──────────────────────────────────── │ parse (AST+regex)  │
│              │   decision-output.v1 JSON             │ + OPA eval + build │
└──────────────┘                                       │ + rules + audit    │
  port cost: 1 HTTP POST. Rust/Go/Python = afternoon.  └────────────────────┘
```

Option B details:

| Concern | Resolution |
|---|---|
| Engine placement | Whole pipeline (parser, engine, builder) moves server-side. Repo already cleanly split: `parser/` `engine/` `output/` — lift as-is into server |
| OPA serving | `opa run --server` Data API (`POST /v1/data/safety/evaluate`) or thin Bun HTTP wrapper calling `opa eval` — either works, existing `OpaCliEngine` reusable verbatim |
| Client | Strip `src/pi/tool-call.ts` to: hook → `POST {raw, cwd, session}` → map `decision=deny` to block. ~50 LOC. Polyglot port trivial |
| Protocol | `decision-output.v1` already agent-agnostic (LD5) — becomes the wire contract, unchanged |
| Audit/unlock-keys | Unlock-key verification (HMAC) moves server-side = BETTER (keys never ship to agents). OTLP ingest co-locates |
| Latency | ~5-15ms LAN vs ~14ms local subprocess (measured turn 1). Negligible; add `cacheTtlMs` (exists) |
| **Server down** | ⚠️ The tension. Dumb client has NO local fallback → pure fail-open (allow everything). If unacceptable: degraded mode = ship tiny frozen rego + local opa = client smart again. Choose: availability-first (fail-open, matches OT2 spirit) or safety-first (hybrid client) |

## Verdict

- Parity/superset via OPA: **YES, exists today**.
- Server-client with YOUR polarity: **YES, but plan must be revised** — Option A (RuleSource fetch, turn-5 sketch) is now wrong for the mandate. Option B is simpler AND more portable; also kills OT8 (no fetch/cache seam needed) and shrinks OT2 (client has nothing to drift — one canonical server).

New open thread to add: fail-mode when server unreachable under pure-dumb-client (fail-open only vs hybrid). Want me to update the findings (new turn 6 + open-threads OT9) to capture this polarity lock?

## Status at end of turn 6

Polarity locked: smart server, dumb client. Option A (turn-5 sketch) superseded. Option B proposed. → See turn 7 for 3-component refinement.
