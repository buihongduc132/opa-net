# References

> Sources consulted during this explore session (2026-08-09, persisted 2026-08-15).

## Source files

### Local pi-opa-net v0.1.0 (`/home/bhd/Documents/Projects/bhd/pi-opa-net/` — stale snapshot)
- `policy/safety.rego` — 33 deny rules; `--no-verify`/`-n` block rule at lines 71-73
- `package.json` — v0.1.0, no `pi.extensions`, bin `pi-opa-net`
- `bin/pi-opa-net.js` — CLI entry; `eval "git commit --no-verify" --json` → deny, exit 2
- `README.md` — v0.1.0 status, "pi-opa-net-ext future repo (OT5)" claim (stale vs deployed)
- `.git/hooks/` — no pre-commit hook installed (only samples)

### Cloned ../opa-net v0.5.0 (`/home/bhd/Documents/Projects/bhd/opa-net/`)
- `package.json` — v0.5.0, `pi.extensions: ["./src/pi/index.ts"]`, keywords incl. unlock-keys
- `src/pi/index.ts` — extension entry; PIOPANET_HOME auto-discovery; registers tool_call
- `src/pi/tool-call.ts` — tool_call hook; PI_SHELL_TOOL_ADAPTERS (bash, Shell); spawns bin eval subprocess; PIOPANET_STRICT fail-closed mode
- `src/pi/runtime-self-check.ts` — Layer A4 self-check (hook-registered, manifest-declared, default-export-is-function)
- `src/engine/OpaCliEngine.ts` — opa eval CLI subprocess; `policyPath` local-file-bound (the hard constraint for remote rules)
- `src/config/Config.ts` — EngineConfig (no policyUrl/rulesUrl); configFromEnv; resolveOpaBinary (mise path)
- `src/audit/sinkFactory.ts` — env-driven sink factory (PIOPANET_OTEL_ENABLED/ENDPOINT) — reusable HTTP pattern
- `src/audit/OtlpAuditSink.ts` — OTLP/HTTP egress sink, graceful degradation — the one existing HTTP seam
- `src/unlock/` — KeyDerivation, KeyParser, KeyVerifier, SaltResolver, UnlockFilter
- `src/signals/`, `src/hermes/`, `src/zcode/`, `packages/hermes-opa-net/`, `packages/zcode-opa-net/` — multi-agent plugin surface
- `policy/safety.rego` — 46 deny rules in this version
- `docs/locked-decisions.yaml` — repo LD1-LD5+; LD2 "NOT remote" topology (conflicts with session LD-S2)
- `docs/open-threads.yaml` — repo OT1-OT4 resolved (hybrid parser, fail-open, bare-stash, pi-safety-net Path A coexistence)
- `CHANGELOG.md` — 0.5.0 herdr rules/dry-run; 0.4.2 A4 crash fix; 0.4.1 deployed-ghost reconciliation
- `openspec/changes/{port-cc-safety-net-rules-to-opa, rule-unlock-keys, conditional-branch-gate}` — existing change artifacts
- `.cupcake/` + `docs/cupcake-parity.md` — Claude Code hook-compatible policy (42 rules)

### Deployed npm pi-opa-net v0.6.0 (`~/.pi/agent/npm/node_modules/pi-opa-net/`)
- `package.json` — v0.6.0, pi.extensions present
- `policy/safety.rego` — 51 deny rules (exceeds cc-safety-net's 38)
- `src/pi/` — adapter present (audit, index, runtime-self-check, tool-call)

### pi runtime config
- `~/.pi/agent/settings.json` — packages list line 60 `"npm:pi-opa-net"` (install only; cc-safety-net NOT referenced)
- `~/.pi/agent/extensions/pi-bash-guard/config.ts` — DEFAULT_GROUPS incl. git-interactive leaky regex; loadConfig precedence; groups-replace semantics
- `~/.pi/agent/extensions/pi-bash-guard/matcher.ts` — decide() ordering: block > prepend/append > timeoutSec > envPreamble > allow
- `~/.pi/agent/extensions/pi-bash-guard/pi-bash-guard.example.json` — config schema documentation
- `~/.pi/agent/cc-safety-net/config.json` — inert stub (v1 comment)
- `~/.cc-safety-net/rules/user-rules/rulebook.json` — 38 active user rules (parity baseline)
- `~/.pi/agent/cmd-family/ospx.yml` — ospx step manifest (01 onboard … 70 archive)

### Checked, unrelated
- `/home/bhd/Documents/Projects/bhd/loopa/` — orchestration toolkit; zero OPA/Rego overlap

## Documents

- GitHub repo `https://github.com/buihongduc132/opa-net` (public) — source of the ../opa-net clone, HEAD `a36a8b7 feat: worktree/branch gating via OPA (LD1-LD8) (#12)`
- npm registry `pi-opa-net@0.6.0` — latest published version

## Code patterns

- **OtlpAuditSink HTTP egress pattern** — env-driven factory (`sinkFactory.ts`), headers, graceful degradation; proposed as template for `RemoteRuleSource` (superseded by turn 8 — no runtime server)
- **pi extension adapter pattern** — `src/pi/index.ts` + `tool-call.ts` + Layer A4 `runtime-self-check.ts`; jiti portability (`fileURLToPath` not `import.meta.dir`)
- **pi-bash-guard group config** — first-match-wins regex groups; effects compose (block/allow/prepend/append/timeoutSec/idleTimeoutSec)
- **pi-bash-guard env preamble** — every bash output prefixed `[pi-bash-guard] ...` = live proof which guard is active

## Patterns explored in turns 6-9 (architecture evolution)

- **Option B smart-server/dumb-client** (turn 6, superseded) — POST /eval from dumb bridge to smart server; porting = 1 HTTP POST. Became moot when turn 8 killed the daemon.
- **3-component server/client/common** (turn 7, superseded) — common = parser+engine+builder shared; server = daemon (REST+UDS); client = bridge with cache. S1 failover ladder (server→cache→fail-mode), S2 digest-conditional sync, S3 UDS discovery, S4 portability (subprocess opa vs in-process), S5 `opa run --server` reuse, S6 repo layout, S7 rules_source in decision record.
- **Minimal single-hook + Ansible** (turn 8, LOCKED) — no daemon; client hook = load ~/.opa-net → eval → gate; Ansible = distribution truck.
- **Unlock-keys in minimal stack** (turn 9) — UnlockFilter client-side, salt at ~/.opa-net/salt via Ansible, TTL keys default + salt rotation as kill switch.

## Documents referenced in turns 6-9
- `opa run --server` — OPA's built-in Data API server (HTTP + UDS), considered in turn 7 S5 then mooted by turn 8
- Repo LD-L1/LD-L2/LD-L6/LD-Y1/LD-Y2 — unlock-key locked decisions cited in turn 9 (per-rule granularity, no god-key, keys never enter OPA, deploy-local salt, decision-record-only audit)
