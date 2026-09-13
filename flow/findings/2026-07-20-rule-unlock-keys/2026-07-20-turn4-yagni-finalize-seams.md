# Explore Turn 4 — YAGNI finalize, seams locked

> Date: 2026-07-20
> Phase: finalization (YAGNI applied to salt + audit)
> Status: complete — all decisions locked, ready to capture as openspec change

---

## [user]

> **[user]** (verbatim — trust chain L1):
>
>    [Q2] SALT location
>         ┌─ deploy-local (~/.pi-opa-net/salt) ─────── my LEAN ─┐
>         │  ✓ machine-specific keys (compromise isolated)      │
>         │  ✗ keys don't transfer across boxes                 │
>         └─────────────────────────────────────────────────────┘
>         alt: global/shared salt file (transferable, weaker)
>         PICK?
>
>    [Q3] LOCATION of unlock check
>         TS-side post-eval filter (see prior turn)
>         → no objection raised, confirming as LOCKED unless you say otherwise.
> > give me YAGNI solutions for now which is be able to easily extend later
>
>    [Q7] AUDIT sink
>         ┌─ decision record only (mandatory source:opa-unlocked) ─┐
>         │  ✓ lives in stdout/JSON, hook captures it              │ minimal
>         └─────────────────────────────────────────────────────────┘
>         alt: + append ~/.pi-opa-net/unlock.log (line per unlock, SIEM-style)
>         PICK?
> > YAGNI

---

## [assistant]

YAGNI locked. Committed to minimal + extensible seams.

### Locked decisions (final)

```
[D-L2] God-key ──────────────── NO
[D-L3] TTL + long-lived ──────── BOTH (self-describing key prefix)
[D-L4] Delivery ──────────────── ENV + --unlock + --unlock-stdin
[D-L5] Granularity ──────────── K1 per-rule ONLY (no K3 — corrected from stale memory)
[D-L6] Location of check ────── TS-side post-eval filter
[D-Y1] Salt ─────────────────── YAGNI: deploy-local default + env override seam
[D-Y2] Audit ────────────────── YAGNI: decision record only + no-op sink seam
```

> **Note**: hindsight memory still records K3 (`--unlock-once`) as shipped — your "Q1: no need unlock-once" overrides it. K3 dropped. Will write a corrected memory at capture time.

### YAGNI choices + extension seams

#### [D-Y1] Salt — minimal now, swappable later

```
 DEFAULT NOW                          SEAM (no rewrite later)
 ──────────────────────               ──────────────────────────────────
 ~/.pi-opa-net/salt                   SaltResolver interface:
   (auto-generated on first              resolve(): Buffer
    pi-opa-net unlock-key)                  ├─ default: readFile(SALT_PATH)
                                          ├─ env:     PIOPANET_UNLOCK_SALT
                                          └─ future:  keychain fetcher
                                          └─ future:  remote salt API
```

**Now:** 1 salt file, 1 env override. 20 lines.
**Later:** add `RemoteSaltResolver`, swap default. Zero callers change.

#### [D-Y2] Audit — minimal now, hook seam later

```
 DEFAULT NOW                          SEAM
 ──────────────────────               ──────────────────────────────────
 Decision record only                 AuditSink interface:
   source: 'opa-unlocked'                onUnlock(record): void
   reasons[].bypassed=true                   ├─ default: NoOpSink
   metadata.unlock_count=1                   ├─ future: FileAppendSink
                                             └─ future: WebhookSink
```

**Now:** everything in `decision-output.v1`. No file.
**Later:** drop in `FileAppendSink`, config wires it. Zero pipeline change.

### Architecture (3 halves + 2 seams)

```
  PARSE ─▶ EVAL (OPA) ─▶ UNLOCK FILTER ─▶ BUILD ─▶ EMIT
                            │                  │
                            │                  └─▶ AuditSink.onUnlock()  [SEAM]
                            │
                  KeyDerivation.derive(rule_id)  [SEAM]
                            │
                  KeyParser.parse(raw_key)
                            │
                  {type:'ll'|'ttl', exp?, mac}
```

### Ship surface (final, minimal)

```
NEW MODULE: src/unlock/
  KeyDerivation.ts    ← HMAC-SHA256(salt, rule_id) → 16 hex
  KeyParser.ts        ← parse 'll_<hex>' | 'ttl.<exp>.<hex>'
  KeyVerifier.ts      ← verify(parsed, rule_id, now): {valid, reason?}
  UnlockFilter.ts     ← filter engine.reasons, demote bypassed
  SaltResolver.ts     ← readFile(~/.pi-opa-net/salt) | env override
  types.ts            ← interfaces (seam points)

NEW SINK: src/audit/
  AuditSink.ts        ← interface + NoOpSink (default)

EDIT:
  policy/safety.rego               ← NO CHANGE (TS-side)
  src/output/DecisionBuilder.ts    ← accept bypassed reasons, new source
  src/output/OutputFormatter.ts    ← emit source:'opa-unlocked'
  src/cli/run.ts                   ← thread PIOPANET_UNLOCK_KEYS, --unlock, --unlock-stdin
  src/config/Config.ts             ← unlock keys + salt path
  schemas/decision-output.v1.json  ← additive: source enum +, bypassed, unlock_*
  src/rules/catalog.ts             ← NO CHANGE (rule_id is hash input, already correct)

NEW CLI: pi-opa-net unlock-key <rule_id> [--ttl <sec>]
```

### Test surface (minimal but real)

```
tests/unit/unlock/
  KeyDerivation.test.ts     ← HMAC deterministic, salt-sensitive
  KeyParser.test.ts         ← ll_*, ttl.*.*, malformed → reject
  KeyVerifier.test.ts       ← valid / wrong-rule / expired / wrong-salt
  UnlockFilter.test.ts      ← mixed valid+invalid → only valid demoted
tests/e2e/
  unlock-flow.test.ts       ← full: mint → env → eval → source:opa-unlocked
tests/unit/audit/
  NoOpSink.test.ts          ← default no-op (extension point)
```

### CA — final list

- `[CA1]` `--unlock` in `ps`/history → document, default ENV.
- `[CA2]` Never log full key, only `unlock_key_id` (first 8 hex).
- `[CA3]` Silent bypass forbidden → `source:opa-unlocked` mandatory.
- `[CA8]` 16 hex (64-bit mac) → collision ~1/10^19, acceptable.
- `[CA9]` TTL clock strict (no skew tolerance) — fail closed on ambiguity.
- `[CA10]` TTL = seconds, negative rejected.
- `[CA11]` Expired TTL key → recorded as `unlock_status:'expired'`, NOT silent.
- `[CA12]` **NEW** — YAGNI seams must stay interfaces, not abstract classes. Pure type + NoOp default. Resist feature creep.

---

**Ready to capture.** Want me to create `openspec/changes/rule-unlock-keys/` with:
- `proposal.md` (why + what + capabilities + impact)
- `design.md` (decisions D-L1…D-L6, D-Y1, D-Y2, risks, migration)
- `specs/rule-unlock/spec.md` (requirements/scenarios)
- `tasks.md` (executable checklist)

Confirm and I draft. Still explore mode — artifacts allowed, code is not.

---

## Status at end of turn 4

- ALL decisions locked: [D-L1]..[D-L6], [D-Y1], [D-Y2].
- YAGNI applied to salt (deploy-local + env seam) and audit (decision-record + NoOp seam).
- Ship surface enumerated: 6 new files in `src/unlock/`, 1 in `src/audit/`, 6 edits to existing files.
- Test surface enumerated: 5 unit + 1 e2e + 1 audit unit.
- CA1–CA12 final list on record.
- Explore session complete. Awaiting user confirmation to capture as openspec change `rule-unlock-keys/`.
