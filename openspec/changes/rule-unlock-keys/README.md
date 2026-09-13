# rule-unlock-keys

> Status: proposed (2026-07-20)
> Source: explore captured in `flow/findings/2026-07-20-rule-unlock-keys/`

Capability-based per-rule bypass for pi-opa-net. Trusted agents present a salted HMAC key derived from `rule_id`; TS-side post-eval filter demotes matching deny reasons. Two lifetimes (long-lived + TTL). All-or-nothing multi-rule semantics. Schema-additive (stays v1).

## Artifacts

- `proposal.md` — why + what + capabilities + impact
- `design.md` — decisions D1–D11 (locked LD-L1..L6, LD-Y1, LD-Y2, LD-G1..G8), risks, migration
- `tasks.md` — TDD phases (RED/GREEN separated per parent custom prompt)
- `specs/rule-unlock/spec.md` — REQ-001..018 + 9 scenarios

## Provenance

Decisions are immutable inputs from `flow/findings/2026-07-20-rule-unlock-keys/2026-07-20-locked-decisions.yaml` (16 entries). This change closes OT1.
