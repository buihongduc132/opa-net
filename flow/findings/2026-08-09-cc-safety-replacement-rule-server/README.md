# cc-safety-replacement-rule-server

> Date range: 2026-08-09 → 2026-08-09 (persisted 2026-08-15)
> Status: proposal-ready (explore concluded; architecture locked in LD-S5)

## Topics

### cc-safety replacement + rule server gap analysis (2026-08-09)
Troubleshot why `git commit --no-verify` isn't gated: two disconnected guards (active pi-bash-guard regex hook never calls pi-opa-net; pi-opa-net Rego rule only reachable via CLI) + regex leak (`git commit -m x --no-verify` passes). Cloned `buihongduc132/opa-net` — NOT a server; it's the same `pi-opa-net` package at v0.5.0 vs local stale v0.1.0 vs deployed npm v0.6.0 (51 rules, pi adapter included, exceeds cc-safety-net's 38). User locked mandate: complete cc-safety replacement + rules served from a server. Structural check: NO server seams exist (engine is local-file-bound via `policyPath`; only OTLP audit egress exists, wrong direction).

### Architecture convergence — smart-server → 3-component → minimal single-hook (2026-08-09, turns 6-9)
Parity/superset confirmed (51 rules > 38, OPA structurally superset). Architecture evolved: turn 6 locked smart-server/dumb-client polarity (Option B) → turn 7 refined to 3-component (server/client/common with fallback + 7 suggestions S1-S7) → turn 8 user simplified to MINIMAL SINGLE-HOOK: no daemon, no runtime server; each client = 1 hook (load ~/.opa-net → eval → allow/gate); opa-net repo houses rules; Ansible deploys to ~/.opa-net (LD-S5 locked, supersedes LD-S2/S3/S4). Turn 9 mapped unlock-keys: carry over unchanged (client-side UnlockFilter, salt via Ansible, TTL default + salt rotation kill switch) — zero new code (LD-S6 locked). 7-item work list derived (turn 8). Remaining open: OT2 canonical source (rank 5), OT3 live gating verification (rank 5).

### Gotcha coverage (2026-08-16, step 20)
3 parallel reviewer batches (architecture / live-gating+parity / unlock-keys) → 41 gotchas: 1×rank5, 11×rank4, 14×rank3, minor rest. Headline: OT10 dual-guard shadowing voids parity (explains --no-verify symptom); OT11 silent under-deny on version skew; OT12/OT13 client-side guard + salt bypassable by guarded agent (threat model must be stated); OT14 salt-path drift breaks "zero new code" claim; OT15 deploy/discovery path mismatches; OT16 subprocess no-timeout. Appendices: turn4a, turn8a, turn9a. 12 new OTs (OT10-OT21, source: gotcha-coverage). No user-locked decision invalidated (reviewer explicitly ranked threat-model gotchas 4 not 5 given trusted-fleet assumption).

## Pick up next time
1. `2026-08-09-turn8-single-hook-ansible-simplify.md` — locked architecture + work list
2. `2026-08-09-turn9-unlock-keys-minimal-stack.md` — unlock-keys mapping
3. Resolve OT2 (canonical source) + OT3 (verify live gating) → then `/opsx:new` for implementation
