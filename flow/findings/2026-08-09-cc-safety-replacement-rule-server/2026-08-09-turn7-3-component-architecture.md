# Explore Turn 7 — 3-component (server/client/common) with fallback

> Date: 2026-08-09
> Phase: explore mode (ospx step 10) — 3-component architecture
> Status: accepted with 7 suggestions (S1-S7)

## Conversation

> **[user]** (verbatim — trust chain L1)
> Hmm , make it 3 component: server / client / common;
> 
> Default rule check path: client -> server ; if server alive , use server , otherwise use the cached one in client;
> client , if be able to connect to server , always sync from server (per 1 HOUR);
> 
> server in daemon mode; if socket is quicker then use it instead of rest (over network);
> 
> the common part: both server and client must be able to resolve the rule itself ;
> 
> ---
> 
> this is the idea , if you have better suggestion , give me ;

### [assistant] — final answer (as-is)

Yes — 3-component is the right call. It resolves the Option A/B tension from last turn: server-smart for freshness, common-smart for fallback. Diagram:

```
                 ┌─────────────────────────────┐
                 │  COMMON  (packages/common)  │
                 │  parser → engine → builder  │
                 │  RuleSet + digest + eval()  │
                 └───────┬─────────────┬───────┘
                  extend │             │ extend
         ┌───────────────▼──┐      ┌───▼────────────────┐
         │  SERVER (daemon) │      │  CLIENT (bridge)   │
         │  ────────────────│      │  ──────────────────│
         │  REST  POST /eval│◀─────│  eval path:        │
         │  UDS  (same box) │ sock │   server if alive  │
         │  GET  /rules+dig │◀─────│   else cached rules│
         │  rule store      │ sync │     → common.eval()│
         │  + audit ingest  │ 1h   │  sync scheduler    │
         └──────────────────┘      └────────────────────┘
```

Your spec, mapped:

| Your idea | Verdict | Note |
|---|---|---|
| Default: client→server, else client cache | ✅ correct | 3-state failover below |
| 1h sync | ⚠️ works, but see S2 | digest-conditional |
| Socket if quicker, REST over network | ✅ | UDS same-box, REST remote (S3) |
| Common resolves rules on both sides | ✅ | = the engine; portability caveat below |

## Suggestions (deltas, not redesign)

**S1 — Pin the failover ladder explicitly:**
```
1. server alive   → POST /eval        (fresh rules, server-side keys)
2. server dead    → cached RuleSet → common.eval() (local opa)
3. cache missing  → fail-mode (open default / closed via PIOPANET_FAIL_MODE)
```
State 3 must exist in spec — first run on a fresh box, server down, no cache.

**S2 — Sync: digest-conditional + drift-detect, not blind 1h fetch.**
Every `/eval` response carries `rulebook_digest` (already in schema metadata). Client compares to its cached digest → syncs immediately on mismatch. Result: new rules propagate within seconds on active sessions; 1h timer only covers idle clients. Full fetch only when digest differs (ETag-style).

**S3 — UDS discovery, not either/or.** Server daemon listens on BOTH: well-known UDS (`$PIOPANET_HOME/opa-net.sock` or `/run/...`) AND REST. Client picks: UDS if socket file exists + connects, else REST URL. Same box = socket; remote agents/other machines = REST. No config branching.

**S4 — Portability honesty (the one real tradeoff):**
- Client WITHOUT fallback = dumb bridge (~50 LOC, any language) — but then spec's "client uses cached one" is gone.
- Client WITH fallback = must port `common` (parser+engine+builder).
Suggestion: **portable core = WASM/binary `opa eval` + shipped rego** — any language client shells out to `opa eval -d cached.rego`, same as today's engine does. Then "common" needs porting only if you want in-process eval. Keep eval-out-of-process and every client is dumb.

**S5 — Server daemon: don't build HTTP eval from scratch.** `opa run --server` already serves `/v1/data/...` over HTTP+UDS. Wrap it: Bun daemon fronts opa-server (or embeds `opa eval`), adds rule-store, digest, sync endpoint, auth, audit ingest. Your common `OpaCliEngine` stays the evaluator inside.

**S6 — Repo layout:**
```
opa-net/
├── packages/
│   ├── common/        ← parser/engine/output/rules (extracted from src/)
│   ├── server/        ← daemon (REST+UDS, rule store, sync, audit)
│   └── clients/
│       ├── pi/        ← thin bridge (current src/pi/)
│       ├── hermes/    ← existing
│       └── zcode/     ← existing
```
Matches existing `packages/{hermes,zcode}-opa-net` pattern already in `../opa-net`.

**S7 — Clock rule for rules staleness:** decision record should carry `rules_source: server|cache|bundled` + `rulebook_digest` (mostly exists in metadata) — audit can then prove which ruleset fired any decision.

Only thing your spec leaves genuinely open: **S4 choice** (fallback = subprocess opa [portable] vs in-process common [TS-only]). Want me to capture this whole exchange as turn 6 + update open-threads/locked-decisions in the findings dir?

## Status at end of turn 7

3-component accepted with 7 suggestions. S4 (portability tradeoff) open. → See turn 8 for simplification.
