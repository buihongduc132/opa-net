# Gotcha Coverage — Batch A (architecture, LD-S5 + work list)

> Source: flow/findings/2026-08-09-cc-safety-replacement-rule-server/ (turns 6-9)
> Mode: findings
> Sub-agent: reviewer (run 630b9be5)
> Units reviewed: LD-S5, OT2, OT9, turn-8 work list, turn-7 S7

## Findings (ranked)

### Rank 4 (Significant)

- **G1: Rego undefined-semantics = silent under-deny on version skew**
  - What: Rules evolve (`data.safety.deny` reading `input.signals.*`, `input.args.*`); parser emitting input lives in client/common/. If client's parser older than ~/.opa-net rules, missing input field in Rego = `undefined` → rule simply doesn't fire → ALLOW. No error, no fail-mode trip.
  - Why missed: Plan treats rules dir + client as independently versioned artifacts (Ansible rules deploy vs npm client install) with no schema contract between input JSON shape and rego expectations.
  - Severity: Deploy new ruleset fleet-wide, old clients silently lose rules. Worse than crash — invisible.
  - Mitigation: (a) version-file min-client-version check → refuse eval if client too old (fail-mode applies); (b) rego `default` + input schema validation; (c) smoke rule "input_schema_v" fired rule must always match, else treat as fail-mode.

- **G2: Client-side guard bypassable by guarded agent**
  - What: Agent under guard has bash. `rm ~/.opa-net/safety.rego`, point `PIOPANET_HOME` at empty dir, `PATH` shadow `opa` shim, edit rego to `allow` all → guard self-disables. No daemon = no out-of-reach authority.
  - Why missed: Threat model never stated. Daemon-less design removes the only tamper-resistant component.
  - Severity: Guard is advisory vs adversarial/self-modifying agents; only protects against accidents.
  - Mitigation: State threat model explicitly (accident-only). If tamper-resistance needed: root-owned ~/.opa-net, digest verified against signed manifest, env-override restriction in prod clients.

- **G3: Missing `opa` binary → fail-mode default decides fleet posture**
  - What: mise provisioning per A4. Non-interactive hook envs often lack mise shims (`~/.local/bin` not in PATH for systemd/cron/spawned contexts). No binary → every eval hits fail-mode. Fail-open = guard silently off fleet-wide; fail-closed = every agent bricked incl. the bash needed to fix it (self-lockout loop).
  - Why missed: A4 lists "ensure opa via mise" as a checkbox; no defined behavior for the window where it's absent + fail-closed lockout not analyzed.
  - Severity: Single misdeploy either disables all protection or freezes all agents.
  - Mitigation: Absolute opa path resolved at install, not PATH; health precheck with loud warning (fail-open + visible indicator, never silent); lockout escape documented (direct config toggle, not via agent bash).

- **G8: Parser must be reimplemented per non-TS client**
  - What: A4 "extract common/ TS package". Hermes/zcode if not TS-runtime cannot consume it; each client reimplements hybrid AST+regex parser. Parser drift → same command → different parsed input → different deny set. Rules parity broken silently (compounds G1).
  - Why missed: A3 framed eval portability (subprocess = portable) but parse portability never addressed — eval was never the TS-locked part.
  - Severity: Cross-client rule parity unenforceable; "1 common rules place" goal undermined.
  - Mitigation: Ship parser as opa-embedded logic (move regex rules into rego, input = raw string only), OR define parser as a language-neutral spec + conformance test vectors all clients must pass.

### Rank 3 (Moderate)

- **G4: Non-atomic Ansible deploy → partial/mid-deploy reads**
  - What: Rules written into ~/.opa-net file-by-file. Client mid-deploy reads rego v0.7 + digest v0.6 (or half-written rego → compile error → fail-mode). Digest/rego/version triple can be inconsistent.
  - Why missed: "Ansible deploys dir" treated as atomic; no swap protocol.
  - Severity: Transient wrong decisions during every deploy window; concurrent agents guaranteed to race it.
  - Mitigation: Deploy to `~/.opa-net/releases/<ver>/` + atomic symlink flip; client reads only via symlink; digest+version live inside release dir.

- **G5: Per-tool-call subprocess cost & hook budget**
  - What: `opa eval -d` re-parses+compiles rego each call (~100–500ms w/ 51 rules, growing). Plus mkdtemp/write/exec per bash call. Latency multiplies per agent × concurrent agents.
  - Why missed: A1 "no complex logic" — but subprocess-per-call IS the recurring cost; no perf budget for hook latency.
  - Severity: Visible lag on every bash tool call; tmpdir litter on crash; possible hook timeouts → spurious fail-mode.
  - Mitigation: `opa build` → precompiled bundle (`opa eval --bundle`) cuts compile; measure and set timeoutMs with margin; tmpdir cleanup guard.

- **G6: `opa eval -d <dir>` loads EVERY .rego file in dir**
  - What: One malformed/stray .rego file (editor backup, per-client experiment, ansible temp) in ~/.opa-net → whole eval fails → fail-mode for all clients. Rego rule-name collision across files → compile error. Same blast radius.
  - Why missed: Layout plan says "rego + digest + version file" — doesn't define single-file vs directory semantics or exclusion of non-rule files.
  - Severity: Fleet-wide fail-mode from one stray file.
  - Mitigation: Exact file list in manifest; `-d` a single file or validated bundle; unknown files → warn + refuse.

- **G7: OPA version drift breaks rego compile**
  - What: Rego syntax/semantics move (`rego.v1` imports, keyword changes). Rules authored against opa 1.x may not compile on 0.x or vice versa. mise "ensure opa" without pin.
  - Why missed: Version pinning absent from A4; opa treated as static dependency.
  - Severity: Compile failure → fail-mode on every call; or subtler semantic differences change decisions.
  - Mitigation: Pin opa version in same manifest as rules; record opaVersion in decision (already a field — enforce it); compile-check in deploy pipeline.

- **G9: Per-client rule scoping absent**
  - What: One shared deny set for pi/hermes/zcode. Pi-specific rules (paths, subcommands, worktree dirs) fire on hermes where semantics differ. No client tag/condition mechanism.
  - Why missed: "Common place of rules for all cli-agents" assumed uniform applicability.
  - Severity: False denials on clients a rule wasn't written for; forces lowest-common-denominator ruleset.
  - Mitigation: `input.client` field + per-rule `applicable_clients` guard in rego; default = all.

- **G10: Config surface not unified**
  - What: Engine takes client-specific config (allowedBranches, worktreeAllowedDirs) via data bundle from Config.ts — pi-shaped. Other clients: what config? Where does hermes get its allowed-branches? Undefined.
  - Why missed: A4 extracts parser/engine/builder; config model left client-local.
  - Severity: Per-client config drift or hardcoded pi assumptions in shared rules.
  - Mitigation: Config schema inside ~/.opa-net manifest, client-agnostic; client supplies identity only.

- **G11: Digest without rulebook archive = non-reproducible audit**
  - What: Decisions carry rulebook_digest, but nothing archives the historical rego that produced each digest (esp. across A2's npm-ghost reconciliation — old digests point at rulesets that never existed in git).
  - Why missed: A5 kept digest as metadata; "prove which ruleset fired" requires digest→content mapping, which is being destroyed by A2 reconciliation options.
  - Severity: Audit trail for pre-canonicalization decisions permanently unverifiable.
  - Mitigation: Archive every published ruleset (git tag or release artifact) before A2 merge; retain npm 0.6.0 rego verbatim as archived snapshot.

### Rank 2 (Minor)

- **G12: Hook-process lifetime staleness**
  - What: Long-lived agent session caches digest/engine at construction; Ansible deploys new rules mid-session → old rules keep firing until restart, decision still labeled with old digest (correct but stale).
  - Why missed: No defined rule-refresh policy for in-flight sessions.
  - Severity: Delayed rollout, confusing mixed-digest audit streams.
  - Mitigation: Re-hash policy per eval (sha256 of small file is cheap) or TTL recheck; log digest on every decision.

- **G13: Windows clients**
  - What: `~/.opa-net`, `opa` binary, execFile, mise, Ansible — all unix-shaped. Any windows-hosted CLI agent client breaks.
  - Why missed: Portability framing (A3) was language-portability, not OS-portability.
  - Severity: Blocked if windows clients ever in scope.
  - Mitigation: Declare unix-only; else `PIOPANET_HOME` + absolute-binary config already mostly suffices.

### Not flagged
tmpdir race (mkdtemp unique — fine); execFile arg-injection (no shell, args array — fine); JSON.stringify input size (bash command strings — small).

## Cross-references
- A-G1 ↔ B-G5/B-G15 (version handshake) → consolidated OT11
- A-G2 ↔ C-F2 (agent self-bypass / mint) → consolidated OT12
- A-G8 relates OT9 (portability)
- A-G11 ties OT2 (canonicalization destroys digest history)
