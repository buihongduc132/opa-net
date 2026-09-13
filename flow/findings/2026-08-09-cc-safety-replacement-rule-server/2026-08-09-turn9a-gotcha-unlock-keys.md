# Gotcha Coverage — Batch C (unlock-keys in minimal stack)

> Source: flow/findings/2026-08-09-cc-safety-replacement-rule-server/ (turn 9)
> Mode: findings
> Sub-agent: reviewer (run 4efcd32a)
> Units reviewed: LD-S6, turn-9 mapping (C2), fleet assumption (C3)

Reviewer verified: implementation matches locked units C1/C2 (verified `UnlockFilter.ts`, `KeyVerifier.ts`, `KeyParser.ts`, `SaltResolver.ts`, `run.ts`, `unlock-key.ts`; LD-G2/G3/G8/G6 all present in code).

Evidence tags: [E1] `src/unlock/SaltResolver.ts:88-96` (env-literal→file-path flip), `:104` (`~/.pi-opa-net/salt` default), auto-gen at `:99-111`. [E2] `src/unlock/KeyDerivation.ts` (HMAC salt = sole master material). [E3] `src/cli/unlock-key.ts:31-53` (mint = read salt + HMAC, no gate). [E4] `src/cli/run.ts:74-79` (ENV keys merged silently).

## Findings (ranked)

### Rank 4 (Significant)

- **F1: Salt file = de-facto god-key; "no god-key" (LD-L2) only holds for key *format*, not key *material*.**
  - What: possession of `~/.opa-net/salt` lets anyone mint valid LL keys for EVERY rule (`unlock-key` does exactly this, no gate beyond file read [E3]). Revocation claims hinge entirely on salt secrecy.
  - Why missed: units discuss key formats and rotation, never that the 42 capabilities collapse to one 32-byte secret per host, held in one Ansible repo for the whole fleet.
  - Severity: single Ansible-control-node / playbook compromise = permanent fleet-wide silent bypass; no per-key revocation possible after salt leak.
  - Mitigation: distinct salt per host + Ansible-vault + per-host issuance; or accept + document "salt = root of all keys" with monitoring on salt file access (auditd).

- **F2: Guarded agent itself can mint keys — guard bypassable via prompt injection.**
  - What: bash guard's purpose = stop injected commands; injected command can run `pi-opa-net unlock-key <rule>` (same user, same salt, [E3]) then re-run the denied command. Zero protection against the actual threat cc-safety-net targets.
  - Why missed: C3 frames agents as "trusted" — but a trusted-agent assumption makes the whole deny+key ceremony unnecessary; the moment an agent is *untrusted enough to need gating*, it's untrusted enough to mint keys.
  - Severity: security model circularity. Within pure accident-prevention framing it's fine; against injection it's theater.
  - Mitigation: salt not readable by the agent's own shell (e.g. issued only via interactive sudo / separate issuing host), or document explicitly that unlock-keys ≠ injection defense.

- **F3: Salt-path drift — code says `~/.pi-opa-net/salt`, architecture says `~/.opa-net/salt`.**
  - What: `SaltResolver` default = `~/.pi-opa-net/salt` [E1], C1 = Ansible to `~/.opa-net/salt`. On new architecture hosts, resolver finds no file → **silently auto-generates a random divergent salt** → all fleet-issued keys become `wrong-salt` → denies stand, no error surfaced.
  - Why missed: C1 claims "zero new code"; nobody reconciled existing hardcoded path with new `~/.opa-net` layout.
  - Severity: unlock silently broken on every deploy; also auto-gen defeats fleet revocation story on any host Ansible missed (rotation never reaches a salt Ansible doesn't know about).
  - Mitigation: config flag or code change for salt path (NOT zero-code); make auto-generate emit loud warning; Ansible assert salt file exists post-deploy.

### Rank 3 (Moderate)

- **F4: ENV-delivered keys persist for whole agent session → unintended auto-bypass.**
  - What: `PIOPANET_UNLOCK_KEYS` set once → every subsequent eval in that session merges ENV keys silently [E4]. Agent "unlocks git-stash for one task", hours later the same session bypasses stash rules with zero fresh intent; audit says `opa-unlocked` but nobody looks.
  - Why missed: C2 lists delivery channels, never key *lifetime in env* / no per-invocation scoping discussion.
  - Severity: capability scope creep from one-command to whole-session.
  - Mitigation: prefer `--unlock` over ENV in docs; TTL-only keys via ENV guidance; or session-scoped env strip.

- **F5: Ansible-deployed salt mode/ownership unverified — mode warning is stderr-only, nobody sees it.**
  - What: `SaltResolver` only `process.stderr.write` a warning on non-0600 [E1]. Ansible `copy` defaults to 0644. Agent subprocesses discard stderr → world-readable salt forever unnoticed.
  - Why missed: C3 says "no hostile local users" — but the 0600 warning machinery exists precisely because this matters, and its sink guarantees invisibility.
  - Severity: salt exposure without any signal (compounds F1).
  - Mitigation: hard-fail (or decision-record signal) on bad mode; Ansible task `mode: '0600'` + assert.

- **F6: Fleet revocation gap — unmanaged hosts + VM image clones.**
  - What: rotation kills keys only where Ansible actually lands. Cloned images carry old salt (keys survive "revocation"); unmanaged hosts auto-gen salt (C1 revocation claim false there).
  - Why missed: C3 asserts "Ansible manages all hosts" as an assumption, never as a *verified invariant*.
  - Severity: urgent-revocation story ("kills ALL derived keys fleet-wide") is best-effort, not guaranteed.
  - Mitigation: Ansible report of hosts touched; embed salt epoch + max-age check in eval (warn when salt older than N days → forces re-deploy attention).

### Rank 2 (Minor)

- **F7: TTL issuance has no max-TTL policy; clock = verifier-local.** — `mintUnlockKey` accepts any `ttlSec` incl. years [E3]; expiry checked against verifier host clock, no skew tolerance. Mitigation: CLI clamp on ttlSec; document clock assumption.
- **F8: `--unlock` in argv → keys visible in `ps`/history; `unlock_key_id` leaks half the key.** — lands in shell history and `/proc/*/cmdline`; audit records first 8 hex of the 16-hex mac. Mitigation: prefer `--unlock-stdin`/ENV; shorten keyId to 6 hex or hash it.
- **F9: `PIOPANET_UNLOCK_SALT` env value = literal OR file path — ambiguous dual semantics.** — if the literal salt string happens to name an existing file, resolver silently reads the file instead [E1]. Mitigation: separate `_FILE` var only — treat env value always as literal.

### Rank 1 (YAGNI)

- **F10: wrong-rule disambiguation = O(reasons × keys × 42) HMACs per eval.** — negligible at catalog size 42. Mitigation: none needed; memoize per (salt, mac) if catalog grows.

## Reviewer assumptions

Ranked F1/F2 at 4 not 5 — C3's stated threat model (own machines, trusted agents) makes them "model-emptiness" rather than invalidating locked decisions; they'd be 5 if injection-defense were a stated goal.

## Cross-references
- C-F1/F2 ↔ A-G2 (client-side bypass family) → consolidated OT12/OT13
- C-F3 ↔ B-G2 (path drift family) → OT15
- C-F4/F5/F6 ↔ B-G6 → OT20
