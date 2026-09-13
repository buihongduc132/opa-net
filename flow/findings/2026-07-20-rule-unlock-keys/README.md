# rule-unlock-keys

> Date range: 2026-07-20 → 2026-07-20
> Status: **DONE** — explored → locked → openspec captured → implemented (TDD) → jewilo-verified → merged → published as pi-opa-net@0.2.0

## Topics

### rule-unlock-keys design explore (2026-07-20)
Explored hidden-bypass/unlock-key feature for pi-opa-net. 4 turns → 16 locked decisions (LD-L1..L6, LD-Y1, LD-Y2, LD-G1..G8) + 16 open threads (all resolved). YAGNI applied to salt + audit. Ship surface: src/unlock/* (6 files), src/audit/AuditSink.ts, src/cli/unlock-key.ts, schema additive, policy unchanged.

### Implementation + deploy (2026-07-20)
Full TDD cycle (RED sub-agent → GREEN sub-agent → 3 RED test-bug fixes by parent). 304/304 tests pass. jewilo verifier-loop APPROVE 2/2 (hash `072026-c604475a`). PR #3 merged to main (commit `5cdd037`). jewilo-dev with rag-quick model APPROVE 2/2 (hash `072026-7291243b`). Published as **pi-opa-net@0.2.0** to npm (manual publish fallback — CI macOS/Ubuntu e2e skip fix also shipped). Global binary install + end-to-end smoke verified.

## Outcome

- **Commit (merge):** `5cdd037` (PR #3 squash)
- **Commit (release):** `bb50a40` (v0.2.0 metadata refresh)
- **npm:** `pi-opa-net@0.2.0` (published 2026-07-20T12:18Z)
- **Verifier proof:** `072026-c604475a` (jewilo pre-merge), `072026-7291243b` (jewilo-dev post-merge, rag-quick)
- **OT1 status:** resolved (openspec captured + shipped)
- **OT2 status:** open (ospx manifest enumeration — escalated to user, low priority)

## Pick up next time
1. OT2 (low priority): enumerate ospx manifest steps 11-70
2. Future: pi-opa-net-ext (the pi tool_call adapter — OT5 from docs/open-threads)
3. Future: gcloud/bq unlock support (LD-G4 — currently out-of-scope)
