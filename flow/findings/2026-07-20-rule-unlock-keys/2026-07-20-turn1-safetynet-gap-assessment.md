# Explore Turn 1 — safety-net gap assessment

> Date: 2026-07-20
> Phase: context-gathering (pre-explore)
> Status: complete — surfaced 2 missing gates (branch delete, rm -rf) that motivated the unlock-keys explore

---

## [user]

> **[user]** (verbatim — trust chain L1):
>
> a. do the current implement all the functionalities of the safety-net ;
> b. do we ported all the current global cc-safety-net rules?
>
> c. do we be able to gate these yet:
> - no git commit --no-verify;
> - no git stash / pop or other act that would clear / wipe the current works ;
> No branch delete ;
> - no rm -rf ; (except in /tmp directory) ;
> - no git add .

---

## [assistant]

Read policy + catalog + canonical rulebook + ran parity tests.

### a. all safety-net functionality implemented?

**Partial — rules + decision engine YES, pi hook wiring NO.**

```
[L?] component                       status
[D1] rule parity (42/42)             ✓ cupcake parity test 68 pass
[D2] decision semantics             ✓ STRICTER than cc-safety-net (solves bare-stash-default)
[D3] structured output (allow+deny) ✓ schema v1, asymmetric-output limitation fixed
[D4] fail-open mode                 ✓ matches pi-safety-net fork guarantee
[D5] pi tool_call hook adapter      ✗ NOT in this repo (OT5 → future pi-opa-net-ext)
```

Engine = done. Adapter that wires it into pi PreToolUse hook = unbuilt.

### b. all global cc-safety-net rules ported?

**YES — 42/42 user rules ported.** Source: `~/.cc-safety-net/rules/user-rules/rulebook.json` (42 rules). Parity test asserts every rulebook `name` appears as `deny.rule_id` → passes.

```
[A1] canonical rulebook snapshot at tests/fixtures/user-rules.rulebook.json
[A2] every `name` → `deny.rule_id` (parity test green)
[A3] reasons copied verbatim
[A4] 4 new tmux/pkill/killall session-kill rules ADDED beyond original pi-opa-net scope
```

NOT ported: cc-safety-net *system* builtins (regex fallback defaults) — not user rules, intentional.

### c. can we gate these yet?

```
[C1] git commit --no-verify         ✓ ALREADY GATED — block-git-commit-no-verify (policy L70-74)
[C2] git stash/pop/wipe             ✓ ALREADY GATED — block-git-stash-mutations + builtin:bare-stash-default
[C3] no branch delete               ✗ NOT GATED — neither `git branch -D/-d` nor `git push origin --delete`
[C4] no rm -rf (except /tmp)        ✗ NOT GATED — no generic rm rule, no /tmp carveout
[C5] no git add .                   ✓ ALREADY GATED — block-git-add-dot (policy L149-154)
```

**3/5 done. 2/5 missing.**

### CA — callouts

- `[CA1]` [C3] [C4] **NOT a regression** — upstream cc-safety-net rulebook itself lacks them (only `-f/-M/-C` force-moves blocked, no generic `rm -rf`). pi-opa-net faithfully ported → inherited the gap.
- `[CA2]` [C3] [C4] **trivial to add in pi-opa-net** — OPA makes these 6-line rules. cc-safety-net's token-OR matcher is the limiting factor upstream; pi-opa-net doesn't have that limit (already proved it with bare-stash-default [D2]). Each new rule = ~8 lines rego + 1 catalog entry + parity test fixture.
- `[CA3]` [C4] **`/tmp` carveout needs `cwd` in input contract** — `decision-output.v1` currently has no `cwd`/`working_dir` field in `input`. Cupcake variant passes `cwd`. To carve `/tmp` either: (a) add `cwd` to input schema, or (b) path-arg match (`/tmp/*`). Decision needed before implement.
- `[CA4]` pi-opa-net still **unwired into pi** [D5] — even after adding [C3] [C4] rules, nothing in this repo blocks a live command until `pi-opa-net-ext` ships.

### A — assumptions

- [A] "all functionalities of safety-net" read as: rule parity + decision contract + fail-mode + hook adapter. Did not check cc-safety-net UI/cache/CLI features (out of scope — pi-opa-net is decision engine only per LD3).
- [A] canonical rulebook = `~/.cc-safety-net/rules/user-rules/rulebook.json` (42 active). Verified by listing — assumes this is current global config.

**Verdict:** to gate [C3] [C4] → 1 short rego PR + fixture. Want me to draft?

---

## Status at end of turn 1

- Established: pi-opa-net has 42/42 rule parity, full decision engine, but no pi hook wiring.
- Gap surfaced: [C3] branch-delete + [C4] rm -rf not gated (inherited from upstream rulebook, trivially fixable in OPA).
- These gaps form context for the unlock-keys explore in turn 2.

→ Continue to `2026-07-20-turn2-explore-unlock-design-forks.md`
