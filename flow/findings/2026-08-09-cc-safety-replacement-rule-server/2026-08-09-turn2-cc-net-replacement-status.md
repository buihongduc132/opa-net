# Explore Turn 2 — cc-safety-net replacement status + is ../opa-net a server?

> Date: 2026-08-09
> Phase: status clarification (pre-explore-mode)
> Status: answered on then-available evidence; partially superseded by turn 3/4 (see Callback)

## Conversation

> **[user]** (verbatim — trust chain L1)
> We are not replacing the cc-net with the pi-opa-net yet? --- also , do we having the ../opa-net as server of the pi-opa-net? Or it is completely unrelated ?

### [assistant] — investigation sequence

```bash
ls /home/bhd/Documents/Projects/bhd/ | grep -i opa; echo '---'; ls /home/bhd/Documents/Projects/bhd/opa-net 2>/dev/null && echo '---OPA-NET-ROOT---' && cat /home/bhd/Documents/Projects/bhd/opa-net/package.json 2>/dev/null | head -30; echo '---OPA-NET-SRC---'; ls /home/bhd/Documents/Projects/bhd/opa-net/src 2>/dev/null; echo '---OPA-NET-README---'; head -40 /home/bhd/Documents/Projects/bhd/opa-net/README.md 2>/dev/null
```

```
[pi-bash-guard] ...preamble...

loopa
pi-opa-net
---
(exited code 1 — no ../opa-net directory existed at that time)
```

```bash
ls /home/bhd/Documents/Projects/bhd/loopa/ 2>/dev/null | head; echo '---PKG---'; cat /home/bhd/Documents/Projects/bhd/loopa/package.json 2>/dev/null | head -20; echo '---README---'; head -30 /home/bhd/Documents/Projects/bhd/loopa/README.md 2>/dev/null; echo '---SRC---'; ls /home/bhd/Documents/Projects/bhd/loopa/src 2>/dev/null
```

```
[pi-bash-guard] ...preamble...

$(pwd)
1
agents
AGENTS.md
artifacts
CLAUDE.md
configs
_DELEGATION.md
docs
flow
---
(no package.json at root)
# loopa

Loopa is a standalone orchestration toolkit that evolves the original `loop_<agent>` bash wrappers into a configurable, testable workflow runner. It keeps the proven cycle semantics—reading `_WYW.md`, logging every iteration, and rotating through CLI agents wired via qlimo/SAI—while layering scheduling, hooks, storage, and management on top.

## Highlights

- **Config-driven workflows**: Define agents, scheduling rules, hooks, and storage in YAML.
- **Scheduling strategies**: Round-robin, explicit sequences, or modulus-based routing (e.g. every 10th cycle).
- **Hook orchestration**: Shared pre/post commands at global, workflow, and per-cycle levels.
- **Pluggable storage**: Persist cycles to JSON log files or SQLite with identical metadata.
- **Run management**: Persist run status in the central state directory (`flow/loopa/state/manager.db` by default), inspect via CLI or the interactive TUI, and prepare for MCP/REST exposure.
- **Materialized workflows**: Generate reusable static YAML snapshots for common agent combinations.
- **Agent aliases**: Use the shared wrapper names (`zqox` → fallback `qox`, `qwe`, `gemy`, `qolo`) while keeping descriptive agent definitions in YAML so storage and hooks stay consistent.
 - **Thin loop over qlimo**: Loopa remains a looping and scheduling layer; all heavy work is executed by qlimo/SAI runners defined in `cli-agents`.

### Staged Scheduling (Parallel Stages)

In addition to `sequence`, `round_robin`, and `modulo`, you can run parallel stages: agents listed in the same stage run concurrently and share the same `global_cycle` number.

Example:

```
workflows:
  demo_staged:
    scheduling:
      strategy: staged
      options:
        stages:
          - agents: [A, B]          # run together
            overrides:
---
src:
cli_helper
loopa
```

```bash
ls ~/.pi/agent/cc-safety-net/ 2>/dev/null | head; echo '---'; head -25 ~/.pi/agent/cc-safety-net/README.md 2>/dev/null; echo '---ACTIVE?---'; grep -l "cc-safety-net\|cc-safety\|safety-net" ~/.pi/agent/settings.json ~/.pi/agent/extensions/*/package.json 2>/dev/null | head; echo '---OPA-NET-IS-SERVER?---'; grep -rn "server\|listen\|http\|express\|bun.serve\|WebSocket" /home/bhd/Documents/Projects/bhd/pi-opa-net/src/ 2>/dev/null | grep -v test | head
```

```
[pi-bash-guard] ...preamble...

cache
config.json
rules
---
(no README)
(empty ACTIVE? results)
---
/home/bhd/Documents/Projects/bhd/pi-opa-net/src/engine/OpaCliEngine.ts:130:    result?: Array<{ expressions: Array<{ value: unknown }> }>;
/home/bhd/Documents/Projects/bhd/pi-opa-net/src/engine/OpaCliEngine.ts:132:    // Single object query → one expression whose value is {allow, deny}.
/home/bhd/Documents/Projects/bhd/pi-opa-net/src/engine/OpaCliEngine.ts:133:    const value = doc.result?.[0]?.expressions?.[0]?.value;
```

→ only hit = OPA JSON `expressions` field — false positive. No server code.

```bash
cat ~/.pi/agent/cc-safety-net/config.json 2>/dev/null | head -40; echo '---RULES-DIR---'; ls ~/.pi/agent/cc-safety-net/rules/ 2>/dev/null | head; echo '---IS-EXT-LOADED?---'; grep -rn "cc-safety\|safetyNet\|cc_safety" ~/.pi/agent/settings.json 2>/dev/null | head
```

```
[pi-bash-guard] ...preamble...

{
  "version": 1,
  "_comment": "Legacy inline-rules format removed. Rules now live in rules/user-rules/rulebook.json (rulebook format). version:1 kept so legacy-detection (legacyRulesConfigNeedsMigration) does not flag this inert stub. Do not add inline rules here; edit the rulebook instead."
}
---
rule.json
rule.lock
user-rules
---
(no settings.json references — inert)
```

### [assistant] — final answer (as-is)

**[R1 Q1]** NO. Not replacing cc-safety-net yet.

State [S1]:
- `cc-safety-net` exists at `~/.pi/agent/cc-safety-net/` but **inert** — config.json = stub, rules moved to `rules/user-rules/rulebook.json`, **NOT referenced in settings.json**.
- `pi-opa-net` = engine+CLI+lib only. README §Status: *"Pi extension adapter lives in separate future repo `pi-opa-net-ext` (OT5) — this package is the engine+library"* → **adapter unbuilt**.
- Active guard today = `pi-bash-guard` (regex groups). Neither cc-safety-net nor pi-opa-net touches the bash hook path.

Replacement path = build `pi-opa-net-ext` → wire into bash tool_call → deprecate `pi-bash-guard` regex rules + retire cc-safety-net stub. Not started.

**[R2 Q2]** NO. No `../opa-net`. Unrelated.

Evidence [E1]:
- `ls ../bhd/` → only `loopa`, `pi-opa-net`. No `opa-net` sibling.
- `loopa` = orchestration toolkit (CLI agents loop runner). Zero overlap with OPA/Rego.
- pi-opa-net itself = **NOT a server**. `grep -rn "server|listen|http|bun.serve" src/` → zero hits (one false positive = OPA JSON `expressions` field).
- Architecture: in-process lib + `opa` CLI subprocess (lazy-loaded via mise). No HTTP.

Callouts [CA1]:
- pi-opa-net = **embedded lib / CLI**, like a linter. No server counterpart exists or is planned (per OT5 scope).
- Contrast: GitNexus/Hindsight DO have centralized Nomad backends (`../noco-mesh`). pi-opa-net intentionally does not — OPA eval is cheap enough to fork per-call.

Assumptions [A]:
- If you saw an "opa-net" reference somewhere, point me — might be stale doc or planned-but-unbuilt.

## Callback (added at persist time — do not rewrite turn)

Turn 3 discovered the GitHub remote `https://github.com/buihongduc132/opa-net` **did exist remotely** (just not cloned locally). Turn 4 revealed it is the same npm package `pi-opa-net` at v0.5.0 — i.e. NOT unrelated: it is a newer fork/source of the same package, and the deployed npm package (v0.6.0) DOES ship the pi adapter (`src/pi/`), invalidating this turn's "adapter unbuilt" statement for the deployed version. The "no server" conclusion still holds as of turn 5.

## Status at end of turn 2

Both questions answered on then-available evidence. → See turn 3 (clone) which partially supersedes R2.
