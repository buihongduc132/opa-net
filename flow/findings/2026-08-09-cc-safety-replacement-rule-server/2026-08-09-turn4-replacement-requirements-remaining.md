# Explore Turn 4 — mandate: full cc-safety replacement + rules from server; what remains

> Date: 2026-08-09
> Phase: explore mode (ospx step 10)
> Status: gap analysis delivered; 4 open questions raised (Q1–Q4)

## Conversation

> **[user]** (verbatim — trust chain L1)
> OUR pi-opa-net must be:
> - complete replacement of cc safety;
> - rules must be from the server in opa-net;
> what are remaining to do

(Attached context in user message: ospx manifest block — Family: ospx · Step 10/70 · Manifest `~/.pi/agent/cmd-family/ospx.yml`; explore-mode stance instructions: thinking not implementing, read-only code investigation, may create OpenSpec artifacts; input = the explore topic.)

### [assistant] — investigation sequence

```bash
diff -rq --exclude=.git --exclude=node_modules --exclude=bun.lock . ../opa-net
```

```
Only in ../opa-net: AGENTS.md
Files ./bin/pi-opa-net.js and ../opa-net/bin/pi-opa-net.js differ
Files ./biome.json and ../opa-net/biome.json differ
Only in ../opa-net: .branchlet.json
Files ./CHANGELOG.md and ../opa-net/CHANGELOG.md differ
Only in ../opa-net: .cupcake
Only in ../opa-net: docs/cupcake-parity.md
Only in ../opa-net: flow
Only in .: .fusion
Files ./.github/workflows/ci.yml and ../opa-net/.github/workflows/ci.yml differ
Files ./.gitignore and ../opa-net/.gitignore differ
Only in .: .gitnexusignore
Only in ../opa-net: .hindsight.json
Only in ../opa-net: openspec
Files ./package.json and ../opa-net/package.json differ
Only in ../opa-net: packages
Only in .: .pi
Files ./policy/safety.rego and ../opa-net/policy/safety.rego differ
Files ./README.md and ../opa-net/README.md differ
Files ./schemas/decision-output.v1.json and ../opa-net/schemas/decision-output.v1.json differ
Files ./skills/pi-opa-net/SKILL.md and ../opa-net/skills/pi-opa-net/SKILL.md differ
Only in ../opa-net/src: audit
Only in ./src: auditor
Files ./src/cli/run.ts and ../opa-net/src/cli/run.ts differ
Only in ../opa-net/src/cli: unlock-key.ts
Files ./src/config/Config.ts and ../opa-net/src/config/Config.ts differ
Files ./src/engine/OpaCliEngine.ts and ../opa-net/src/engine/OpaCliEngine.ts differ
Files ./src/engine/types.ts and ../opa-net/src/engine/types.ts differ
Only in ./src: evaluator
Only in ../opa-net/src: hermes
Files ./src/output/DecisionBuilder.ts and ../opa-net/src/output/DecisionBuilder.ts differ
Only in ../opa-net/src/parser: checkoutTarget.ts
Files ./src/parser/index.ts and ../opa-net/src/parser/index.ts differ
Files ./src/parser/ShellQuoteParser.ts and ../opa-net/src/parser/ShellQuoteParser.ts differ
Only in ../opa-net/src/parser: stripGitGlobalOptions.ts
Files ./src/parser/types.ts and ../opa-net/src/parser/types.ts differ
Only in ../opa-net/src: pi
Only in ./src: policies
Files ./src/rules/catalog.ts and ../opa-net/src/rules/catalog.ts differ
Files ./src/rules/RuleRegistry.ts and ../opa-net/src/rules/RuleRegistry.ts differ
Only in ../opa-net/src: signals
Only in ../opa-net/src: unlock
Only in ../opa-net/src/util: canonicalizePath.ts
Only in ../opa-net/src: version.ts
Only in ../opa-net/src: zcode
Only in ../opa-net/tests: cupcake
Only in ../opa-net/tests/e2e: block-rm-rf-dangerous-target.test.ts
Only in ../opa-net/tests/e2e: cli-contract.test.ts
Files ./tests/e2e/e2e.test.ts and ../opa-net/tests/e2e/e2e.test.ts differ
Only in ../opa-net/tests/e2e: hermes-extension-e2e.test.ts
Only in ../opa-net/tests/e2e: pi-extension-e2e.test.ts
Only in ../opa-net/tests/e2e: pi-session-smoke.test.ts
Only in ../opa-net/tests/e2e: pi-session-worktree-smoke.test.ts
Only in ../opa-net/tests/e2e: unlock-flow.test.ts
Only in ../opa-net/tests/e2e: worktree-gating-e2e.test.ts
Only in ../opa-net/tests/e2e: zcode-extension-e2e.test.ts
Only in ../opa-net/tests: fixtures
Only in ../opa-net/tests: hermes
Only in ../opa-net/tests: pi
Only in ../opa-net/tests/unit: audit
```

Package.json comparison (key deltas as pasted):
- `../opa-net`: version **0.5.0**, keywords include `pi-package`/`pi-extension`/`capability-based`/`unlock-keys`, and `"pi": { "extensions": ["./src/pi/index.ts"], "skills": ["./skills"] }`
- `./pi-opa-net` (local): version **0.1.0**, no `pi.extensions`, skills only

`../opa-net` structure discovered:
- `src/pi/` — **the pi extension adapter**: `audit.ts`, `index.ts`, `runtime-self-check.ts`, `tool-call.ts`
- `packages/hermes-opa-net/`, `packages/zcode-opa-net/` — other-agent plugin packages
- `src/unlock/` — KeyDerivation, KeyParser, KeyVerifier, SaltResolver, UnlockFilter
- `src/signals/` — EnvSignals, RepoSignals, WorktreeSignals
- `src/audit/` — AuditSink, MultiSink, OtlpAuditSink, sinkFactory
- `openspec/changes/`: `conditional-branch-gate`, `port-cc-safety-net-rules-to-opa`, `rule-unlock-keys`
- `.cupcake/` — cupcake-compatible policy for Claude Code

`src/pi/index.ts` (full, as read): auto-discovers `PIOPANET_HOME` from `PI_CODING_AGENT_DIR` / `PI_SESSION_FILE` + `<agentDir>/pi-opa-net/rules`, then `registerToolCallEvent(pi); markHookRegistered();` — re-exports `handlePiToolCall`.

`src/pi/tool-call.ts` (head, as read): registers `pi.on('tool_call', handlePiToolCall)`; fail-closed constants `REASON_OPA_NET_FAILED_CLOSED` / `REASON_MALFORMED_SHELL_INPUT`; `PI_SHELL_TOOL_ADAPTERS = { bash: {commandField:'command'}, Shell: {commandField:'command', cwdField:'working_directory'} }`; strict mode via `PIOPANET_STRICT=1`; default eval spawns `bin/pi-opa-net.js eval` subprocess and parses DecisionOutput.

`src/pi/runtime-self-check.ts` (Layer A4, as read): verifies hook-registered, manifest-declared (`pi.extensions` non-empty), extension-default-export-is-function. CHANGELOG 0.4.2 records the `import.meta.dir` crash fix (Bun vs Node/jiti portability).

Docs read:
- `docs/open-threads.yaml` — OT1 hybrid parser, OT2 fail-open, OT3 bare-stash in rego, OT4 KEEP pi-safety-net as Path A / pi-opa-net Path B with migration story "pi-safety-net's rules fold INTO this repo's rego policy", status: resolved.
- `docs/locked-decisions.yaml` — LD1 OPA not Cedar; **LD2 "OPA deployment topology = on every dev box, lazy-loaded (local sidecar/daemon; not remote). status: locked"**; LD3 bash-guarding only; LD4 --json output only; LD5 schema v1.0 symmetric, exit 0/2.

CHANGELOG highlights (as read):
- 0.5.0 (2026-07-31): herdr session-protection rules (4 new; `session_kill_targets` extended w/ herdr, bermuda); `pi_opa_net_version` in all audit traces; `PIOPANET_DRY_RUN` safety mode.
- 0.4.2 (2026-07-24): CRITICAL A4 self-check crash fix (`import.meta.dir` undefined under Node/jiti).
- 0.4.1 (2026-07-24): **"Reconciled deployed 0.4.0 ghost into repo main. The deployed production copy (~/.pi/agent/npm/node_modules/pi-opa-net/) contained unpublished features (OTLP/HTTP audit sink, MultiSink fan-out, config-driven audit factory, rm -rf dangerous-target policy) that had never been committed to git"**; `block-rm-rf-dangerous-target` rule added; A4 regression restored.

Deployment checks (as read):
- Deployed `~/.pi/agent/npm/node_modules/pi-opa-net/package.json`: version **0.6.0**, `pi.extensions: ["./src/pi/index.ts"]`, skills
- Deployed `policy/safety.rego`: **51 deny blocks**
- Deployed `src/pi/`: audit.ts, index.ts, runtime-self-check.ts, tool-call.ts — **adapter present**
- `~/.pi/agent/settings.json:60`: `"npm:pi-opa-net"` in packages
- cc-safety-net rulebook `~/.cc-safety-net/rules/user-rules/rulebook.json`: **38 rules** (sample: block-git-commit-am, block-git-rebase-continue, block-bd-notes-flag)
- cc-safety-net NOT referenced in pi settings (inert)
- pi-bash-guard not in settings.json packages (extension dir load)

Rule/version counts (as measured):
- Local ./pi-opa-net: v0.1.0, 33 deny rules
- ../opa-net repo: v0.5.0, 46 deny rules
- npm deployed: v0.6.0, 51 deny rules
- npm latest (registry): v0.6.0
- cc-safety-net rulebook: 38 rules

`~/.pi/agent/cmd-family/ospx.yml` steps (as read): 01 onboard · 10 explore · 20 new · 30 continue · 30a ff · 40 apply · 40a apply-delegate · 50 verify · 60 sync · 70 archive · 70a bulk-archive.

### [assistant] — final answer (as-is)

Stop. Big finding first — the premise needs correcting before gap analysis means anything.

## The reveal: `opa-net` is not a server

`../opa-net` is **not a server**. It's a newer **fork of the same npm package** (`pi-opa-net`). Same `package.json` name, same bin, same schemas — just 4 major versions ahead. You now have **three diverging copies**:

```
┌─────────────────────────────────────────────────────────────────┐
│  THREE SOURCES, THREE VERSIONS, ZERO SERVERS                     │
├──────────────────┬──────────┬───────────┬───────────────────────┤
│ Source           │ Version  │ Deny rules│ Has pi adapter?       │
├──────────────────┼──────────┼───────────┼───────────────────────┤
│ ./pi-opa-net     │ v0.1.0   │    33     │ NO  (engine only)     │
│ ../opa-net (GH)  │ v0.5.0   │    46     │ YES (src/pi/)         │
│ npm deployed     │ v0.6.0   │    51     │ YES (what runs NOW)   │
│ cc-safety-net    │   —      │    38     │ n/a (JSON rulebook)   │
└──────────────────┴──────────┴──────────┴───────────────────────┘
```

The deployed npm v0.6.0 **already exceeds cc-safety-net** (51 vs 38 rules) and **already has the pi extension adapter** (`src/pi/index.ts` → `tool_call` hook → spawns `bin/pi-opa-net.js eval` per bash command). The engine replacement is essentially done — in npm. Your local `./pi-opa-net` is a stale v0.1.0 snapshot.

## Requirement 1: "complete replacement of cc safety"

**Engine: mostly DONE** (in deployed v0.6.0). Gaps:

```
┌──────────────────────────────────────────────────────────────┐
│  CC-SAFETY-NET REPLACEMENT — REMAINING                        │
├──────────────────────────────────────────────────────────────┤
│
│  ✅ Rule parity (51 > 38, exceeds)         — npm v0.6.0       │
│  ✅ pi extension adapter (src/pi/)         — npm v0.6.0       │
│  ✅ tool_call hook → subprocess eval       — npm v0.6.0       │
│  ✅ Fail-open default (LD2)                — all versions     │
│  ✅ Schema v1.0 decision-output            — all versions     │
│
│  ❌ SOURCE CANONICALIZATION ⚠️ BIGGEST ISSUE                 │
│     Which repo is truth? Local v0.1.0, ../opa-net v0.5.0,    │
│     or npm v0.6.0? Three diverging forks = drift bomb.       │
│     v0.6.0 was a "ghost deploy" (per CHANGELOG 0.4.1:        │
│     "unpublished features... never committed to git").        │
│
│  ❌ LIVE GATING NOT VERIFIED                                 │
│     Extension is deployed but does it actually intercept?    │
│     The "--no-verify not gated" bug = the adapter's subprocess│
│     may be failing silently, OR pi-bash-guard shadows it,    │
│     OR the hook isn't loading. Needs instrumentation.         │
│
│  ❌ cc-safety-net RETIREMENT                                │
│     ~/.cc-safety-net/ still exists (inert stub, 38 rules).   │
│     Rulebook.json still maintained. No migration/cutover.    │
│
│  ❌ Local ./pi-opa-net RECONCILE or DEPRECATE                │
│     v0.1.0 is 4 versions behind. Either pull v0.6.0 down     │
│     or delete this repo and use ../opa-net as canonical.     │
│
└──────────────────────────────────────────────────────────────┘
```

## Requirement 2: "rules must be from the server in opa-net"

**No server exists. This is greenfield.** And it **directly conflicts with LD2**:

```yaml
# ../opa-net/docs/locked-decisions.yaml
- id: LD2
  decision: >
    OPA deployment topology = on every dev box,
    lazy-loaded (local sidecar/daemon; NOT remote).
  status: locked
```

```
┌──────────────────────────────────────────────────────────────┐
│  CURRENT (bundled rules)          DESIRED (served rules)      │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────────┐                  ┌─────────────┐            │
│   │ pi-opa-net  │                  │ pi-opa-net  │            │
│   │  (client)   │                  │  (client)   │            │
│   │             │                  │             │            │
│   │ policy/     │                  │   ┌─────┐  │            │
│   │ safety.rego │  ← shipped       │   │fetch│───────┐      │
│   │ (bundled)   │    with pkg      │   └─────┘   │  │       │
│   └──────┬──────┘                  └─────┬───────┘  │       │
│          │                               │          ▼       │
│          ▼                               │   ┌────────────┐ │
│   ┌─────────────┐                        │   │  opa-net   │ │
│   │  opa (CLI)  │                        │   │  SERVER    │ │
│   │  local      │                        │   │            │ │
│   │  subprocess │                        │   │ GET /rules │ │
│   └─────────────┘                        │   │ → rego blob│ │
│                                          │   │ OTLP audit │ │
│                                          │   └────────────┘ │
│                                          │          │       │
│                                          ▼          ▼       │
│                                   ┌──────────────────────┐ │
│                                   │  opa (CLI) local     │ │
│                                   │  evaluates fetched   │ │
│                                   │  rego                │ │
│                                   └──────────────────────┘ │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

**Why serve rules centrally?** (surface your own reasoning)
- Single source of truth — kills the 3-way drift above
- Update rules once → all dev boxes get them (no npm publish/redeploy)
- Enables per-team, per-user, per-project rule overlays
- Enables remote unlock-key issuance + revocation (the v0.2.0 unlock-keys feature becomes more powerful with a server)

**What the server needs (greenfield — in `../opa-net` or new repo?):**

| Component | Purpose | Status |
|-----------|---------|--------|
| HTTP listener (`GET /rules`) | Serve `safety.rego` + digest | **NONE** |
| Rule versioning + digest | Client caches + invalidates | `rulebook_digest` exists in metadata |
| Client fetch+cache layer | pi-opa-net pulls rego on startup/TTL | **NONE** (engine reads local file) |
| `PIOPANET_RULES_URL` env | Config knob to point at server | **NONE** |
| Fallback when server down | Use cached rego (fail-open) | partial (fail-open exists, cache doesn't) |
| Audit ingest endpoint | Server collects OTLP/JSONL decisions | OTLP sink exists client-side, no server endpoint |
| Unlock-key issuance API | Trusted agents request keys | unlock-key CLI exists, no API |
| Auth (who can read/write rules) | Don't serve modified rules to anyone | **NONE** |
| LD2 amendment | Unlock "not remote" → "remote with local fallback" | **REQUIRED** |

## The real questions before "what remains"

**Q1 — Canonicalize source first?** Three forks is the actual rot. Before building a server, pick:
- (a) `../opa-net` (v0.5.0) is canonical, npm v0.6.0 gets re-published FROM it, local `./pi-opa-net` gets deleted
- (b) npm v0.6.0 gets reverse-engineered back into `../opa-net` as v0.7.0
- (c) Merge everything into one repo

Without this, any server work drifts immediately.

**Q2 — Does the live gating actually work?** The previous-turn bug ("can't gate `--no-verify`") suggests the deployed v0.6.0 adapter may not be intercepting. Worth instrumenting BEFORE adding a server — otherwise you serve rules to a client that ignores them.

**Q3 — LD2 overturn:** Serving rules remotely contradicts a LOCKED decision. Is this a deliberate override (amend LD2), or do you want a hybrid (server-authoritative, local-cached fallback)?

**Q4 — Server scope:** Just rule-serving (read-only blob)? Or full control plane (rules + unlock-keys + audit ingest + admin)? The latter is a real product; the former is a Saturday.

---

## Next actions (ospx steps > 10)

```
step 20  new       → start an OpenSpec change for "rule-server" (after Q1-Q4 answered)
step 30  continue  → or pick up an existing ../opa-net openspec change:
                       • port-cc-safety-net-rules-to-opa
                       • rule-unlock-keys
                       • conditional-branch-gate
step 30a ff        → fast-forward if scope is already crisp
step 40  apply     → implement (exit explore first)
step 50  verify    → gate tests pass
step 60  sync      → npm publish + deploy
step 70  archive   → cc-safety-net retirement
```

Which thread do you want to pull first — canonicalization (Q1), live-gating instrumentation (Q2), or the server design (Q3/Q4)?

## Status at end of turn 4

Mandate captured (2 locked decisions). Four questions open (canonicalization, live gating, LD2, server scope). → See turn 5 for structural alignment check.
