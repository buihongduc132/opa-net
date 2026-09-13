# Explore Turn 8 — simplification: single hook + Ansible, no daemon

> Date: 2026-08-09
> Phase: explore mode (ospx step 10) — architecture simplification
> Status: daemon killed; final minimal shape locked; work list derived

## Conversation

> **[user]** (verbatim — trust chain L1)
> Wait , it is simpler to make our plugins just 1 single hook:
> 
> - load config from central / common place ;
> - eval;
> - allow / gate act ;
> 
> opa-net repository house the rules , we will implement here , Ansible deploy to the ~/.opa-net;
> 
> no complex logic;
> 
> intention of the server is that 1 common place of rules for all cli-agents; it is it , that simple;

### [assistant] — final answer (as-is)

Right — that kills the daemon entirely. "Server" was never a runtime; it's just **the rules directory + Ansible**. Distribution = deploy, not HTTP. Much simpler, and honestly the correct call for a fleet you already manage with Ansible.

## Final shape

```
opa-net repo (single source of truth, implements here)
│
├── policy/rules          ← THE rules (all agents share)
├── common/               ← parser + engine + builder (eval core)
└── clients/
    ├── pi/       ┐
    ├── hermes/   │  each = 1 hook: load ~/.opa-net → common.eval(cmd) → allow/gate
    └── zcode/    ┘   (dumb bridges; porting = copy hook pattern)

        Ansible deploy: repo → ~/.opa-net (rules + version + digest)
```

Client hook = exactly your 3 lines:

```
1. load rules from ~/.opa-net        (env override PIOPANET_HOME already exists)
2. common.eval(command)              (existing OpaCliEngine, local opa binary)
3. decision=deny → block
```

## What this collapses

| Prior thread | Now |
|---|---|
| OT5 server scope | **dead** — no runtime server |
| OT7 server home | **dead** — `~/.opa-net`, Ansible-managed |
| OT8 RuleSource/fetch/cache | **dead** — file load, zero sync logic |
| OT4 LD2 amendment | **trivial** — still "local files", Ansible is just a delivery truck; arguably no LD2 violation at all |
| Rule updates | `git push` → `ansible-playbook` → fleet updated; no 1h timer, no digest protocol needed |
| Fresh-machine bootstrap | Ansible handles (installs opa via mise + deploys rules in one pass) |

## Remaining (the actual work list)

1. **Canonicalize** — reconcile npm v0.6.0 ghost into `../opa-net` main (OT2, still the only rank-5)
2. **Extract common/** — move parser/engine/output out of single package so clients depend on it, not the whole pi package
3. **Rules layout at `~/.opa-net`** — rego + digest + version file; existing `PIOPANET_HOME` discovery already points there
4. **Ansible role** — deploy rules (+ mise opa ensure); trivial
5. **Thin client hooks** — strip `src/pi/tool-call.ts` to load/eval/gate (already ~90% there in deployed v0.6.0)
6. **OT3** — verify live gating actually intercepts (unchanged, still needed)
7. **cc-safety-net retirement** — 38 rules already folded; archive dir

One caution only: no server = no remote unlock-key revocation / central audit. Fine — filesystem audit + local keys still work; revisit only if fleet grows.

Want this captured (turns 6-7 + updated locked-decisions/open-threads) before starting `/opsx:new`?

## Status at end of turn 8

Daemon killed. Minimal single-hook architecture locked. 7-item work list derived. → See turn 9 for unlock-keys question.
