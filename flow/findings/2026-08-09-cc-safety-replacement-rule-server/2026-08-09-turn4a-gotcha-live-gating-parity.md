# Gotcha Coverage — Batch B (live gating + parity)

> Source: flow/findings/2026-08-09-cc-safety-replacement-rule-server/ (turns 1-4 themes, mandate turn)
> Mode: findings
> Sub-agent: reviewer (run 449deb80)
> Units reviewed: OT3, OT1, LD-S1, OT6, turn-2 conclusion (rulebook format gap)

## Findings (ranked)

### Rank 5 (Sophisticated — alarm)

- **G1: pi-bash-guard shadowing makes parity irrelevant**
  - What: If BOTH pi-bash-guard and pi-opa-net register `tool_call` hooks, execution order determines which rules apply. If pi-bash-guard fires first and returns `{block: false}` (pass), pi-opa-net may never be invoked OR receives the REWRITTEN command. B2 leak (`git commit --no-verify -m x` passes pi-bash-guard regex) means pi-opa-net's superior rule coverage is BYPASSED.
  - Why missed: Units assume single-guard model. No analysis of multi-hook interaction, event propagation semantics, or short-circuiting behavior in pi's extension system.
  - Impact: B3 parity claim (51 rules > 38 rules) is VOID if weaker guard blocks first. B1 symptom ("git commit --no-verify NOT gated") explained if pi-bash-guard passes it before pi-opa-net evaluates.
  - Mitigation: (1) Verify pi's hook execution order (serial all-handlers OR first-block-wins). (2) If serial, ensure pi-opa-net registers BEFORE pi-bash-guard. (3) If first-block-wins, DISABLE pi-bash-guard when pi-opa-net active. (4) Add telemetry to detect shadowing in production.

### Rank 4 (Significant)

- **G2: PIOPANET_HOME auto-discovery path mismatch vs Ansible deployment**
  - What: Code checks `<agentDir>/pi-opa-net/rules/` but B4 states "Ansible to ~/.opa-net". If Ansible deploys to `~/.opa-net` but code looks for `~/.pi/agent/pi-opa-net/`, auto-discovery fails → falls back to stale package-bundled policy.
  - Why missed: Units reference "Ansible to ~/.opa-net" but code review shows different path logic. No verification of deployed vs discovered path alignment.
  - Impact: Live sessions run WRONG ruleset (package-bundled v0.6.0 vs deployed latest). Explains B1 gating failure if deployed rules fixed the leak but package-bundled didn't.
  - Mitigation: (1) Align Ansible target with auto-discovery logic OR (2) set `PIOPANET_HOME=~/.opa-net` in pi's env OR (3) extend auto-discovery to check `~/.opa-net` as fallback.

- **G3: Subprocess spawn depends on `bun` in PATH (runtime assumption unverified)**
  - What: `spawn('bun', [binPath, ...])` hardcoded. If pi runs under Node and bun not installed, subprocess never spawns → silent fail-open.
  - Why missed: Deployment environment assumptions (bun availability) not validated. No fallback to `node` or runtime detection.
  - Impact: Hook inactive in non-bun environments. Explains B1 if production pi uses Node.
  - Mitigation: (1) Detect runtime (`process.versions.bun` vs `process.versions.node`) and choose `bun` or `node`. (2) Pre-flight check that chosen binary exists. (3) Log spawn failures even in fail-open mode.

- **G4: Subprocess has NO timeout → hanging eval bricks agent**
  - What: `spawn` call lacks timeout. If `bin/pi-opa-net.js eval` hangs (OPA deadlock, infinite loop), hook blocks forever. Pi's bash tool has timeout but this doesn't inherit it.
  - Why missed: Async subprocess error handling analyzed, but availability (timeout) not considered.
  - Impact: Single slow command freezes entire agent session. Worse than fail-open (at least commands execute).
  - Mitigation: (1) Add `setTimeout()` kill after 5-10s. (2) Surface timeout as fail-open or fail-closed based on `PIOPANET_STRICT`.

- **G5: No version parity check between extension (v0.6.0) and binary**
  - What: Extension expects `bin/pi-opa-net.js` with exit codes 0/2/other. If PATH shadowing or old binary installed, version mismatch causes silent failure (wrong exit codes, wrong JSON schema).
  - Why missed: Deployment assumes atomic npm install. No runtime version handshake.
  - Impact: User installs v0.6.0 but accidentally runs v0.4.0 binary → gating logic breaks. Explains B1 if binary is outdated.
  - Mitigation: (1) Binary emits version in JSON output. (2) Hook validates version match. (3) Fail-closed on mismatch.

- **G6: Fail-open + unlock keys → `fail-open-keyless` IGNORES keys (LD-G1 contradiction)**
  - What: Code: "OPA down + keys present → fail-open-keyless (NOT opa-unlocked)". User provides unlock key expecting it to work, but OPA unavailable → key silently ignored → command passes WITHOUT unlock semantics.
  - Why missed: LD-G1 states behavior but doesn't analyze user expectation mismatch.
  - Impact: User confusion. Key appears accepted (no error) but has NO effect. If user unlocks destructive command and OPA is down, they think it's safe but it's just fail-open.
  - Mitigation: (1) Emit warning when keys present but fail-open triggered. (2) OR fail-closed when keys present (stricter: "keys imply user knows risk, don't degrade").

- **G7: cc-safety-net "still maintained" (B4) contradicts "pi-opa-net is replacement" (B3)**
  - What: If cc-safety-net JSON rulebook receives updates, pi-opa-net Rego drifts. No automated sync. B3 claims parity NOW but doesn't address future governance.
  - Why missed: B4 flags cc-safety-net as "still maintained" but doesn't analyze drift over time. B5 notes format incompatibility but not maintenance ownership.
  - Impact: Parity claim time-limited. If cc-safety-net adds rule X and pi-opa-net doesn't, B3 invalidated. Users relying on "superset" claim are exposed.
  - Mitigation: (1) Declare pi-opa-net as NEW source of truth, freeze cc-safety-net. (2) OR automate JSON→Rego translation in CI. (3) OR merge repos and deprecate JSON format.

- **G8: B5 format gap (no bare-subcommand defaults) NOT bridged — cc-safety-net `git stash` rules won't translate**
  - What: B5 states cc-safety-net can't express "git stash ≡ git stash push". If cc-safety-net has `{command: "git", subcommand: "stash", block_args: ["pop"]}`, it DOESN'T block bare `git stash` (which defaults to push). Rego CAN express this, but translation from JSON loses it.
  - Why missed: B5 identifies limitation but doesn't trace impact on rule migration. If cc-safety-net rules assume explicit subcommands, Rego version must ADD implicit defaults manually.
  - Impact: Rules ported from JSON may have WEAKER coverage than intended. `git stash` (implicitly push) might not trigger block-git-stash-mutations if rule only checks `args` not subcommand default.
  - Mitigation: (1) Audit all ported rules for implicit-subcommand commands. (2) Document Rego enhancements over JSON. (3) Add test cases for bare commands with defaults.

### Rank 3 (Moderate)

- **G9: Compound command splitting breaks quoted semicolons**
  - What: `raw.split(';')` naively splits `echo "foo; bar"` → `["echo \"foo", "bar\""]`. Real-world commands with semicolons in strings mis-parsed.
  - Why missed: Units mention compound command handling but don't test edge cases.
  - Impact: False deny on benign commands with quoted semicolons.
  - Mitigation: Use shell-aware parser (ShellQuote already in repo) to split on UNQUOTED semicolons only.

- **G10: Shell tool adapter only recognizes `bash` and `Shell` — new tools bypass**
  - What: `PI_SHELL_TOOL_ADAPTERS` has 2 entries. If pi adds `zsh`, `sh`, `command` tools, hook returns `undefined` (pass).
  - Why missed: Assumes static tool set. No forward compatibility analysis.
  - Impact: Future pi versions add shell tools that bypass gating.
  - Mitigation: (1) Adapter registry extensible via config. (2) Emit warning on unknown tool. (3) Default to block unknown shell tools (fail-closed).

- **G11: Signal collection only for `git` commands — non-git rules (rm, chmod) get `undefined` signals**
  - What: `collectSignals` returns `undefined` if `parsed.program !== 'git'`. But B3 claims 51 rules (many non-git). Do rm/chmod rules need signals?
  - Why missed: Signal design assumes git-centric model. No analysis of non-git rule needs.
  - Impact: Non-git rules may fail or behave incorrectly if they depend on missing signals (e.g., cwd, env vars).
  - Mitigation: (1) Audit all rules for signal dependencies. (2) Extend signal collection to non-git commands.

- **G12: Audit sink creation per-deny adds latency**
  - What: `createAuditSink({ cwd })` called inside hook on every deny. If disk I/O expensive, blocks user.
  - Why missed: Correctness over performance focus.
  - Impact: Slow denies annoy user. Not a bug but UX degradation.
  - Mitigation: Instantiate sink once at extension load, reuse across calls.

- **G13: Self-check NOT invoked automatically — B1 hypothesis (iii) unverifiable**
  - What: `runSelfCheck()` exported but never called. If hook fails to load, no diagnostic.
  - Why missed: A4 layer exists but not wired into production path.
  - Impact: B1 "hook not loading" hypothesis can't be ruled out without manual check.
  - Mitigation: (1) Call `runSelfCheck()` at extension load, log results. (2) OR expose as CLI command `pi-opa-net self-check`.

- **G14: No validation that discovered `rules/` dir contains usable .rego files**
  - What: Auto-discovery checks `existsSync(join(candidate, 'rules'))` but not contents. Empty dir passes check → engine has no rules.
  - Why missed: Deployment verification assumed complete. Only checks dir, not file presence.
  - Impact: Silent degradation to fail-open if deployment writes empty dir.
  - Mitigation: Check for `*.rego` files in dir OR validate OPA compilation succeeds.

- **G15: Exit code mismatch if `bin/pi-opa-net.js` changes schema**
  - What: Hook expects 0=allow, 2=deny. If binary changes to 1=deny (or adds new codes), hook misinterprets.
  - Why missed: Protocol contract assumed stable. No explicit version negotiation.
  - Impact: Silent mis-classification of allow/deny.
  - Mitigation: Document exit code contract in schema. Add version check (G5).

### Rank 2 (Minor)

- **G16: `formatBlockReason` crashes if `decision.reasons` empty** — accesses `reasons[0]?.family` without validating array. Malformed OPA output crashes hook. Mitigation: validate decision schema before formatting.
- **G17: Audit write NOT awaited before returning block** — async `writeAuditEntry` races. Audit loss if write slow. Mitigation: await OR document fire-and-forget explicitly.
- **G18: No defensive check that `pi.on` exists** — API change = crash on load. Mitigation: `typeof pi?.on === 'function'` guard.

### Rank 1 (YAGNI)

- **G19: JSON parse error exposes partial stdout (200 chars)** — theoretical secret leak. Mitigation: redact or opaque message.

## Summary

5×Sev5 (1), 4×Sev4 (7), 3×Sev3 (6), 2×Sev2 (3), 1×Sev1 (1) = 18 findings.

Critical: G1 (shadowing) explains B1+B2 fully. G2 (path mismatch) explains deployment gap. G7+G8 invalidate B3 parity long-term. G4 (timeout) is availability blocker.

## Cross-references
- B-G1 ↔ OT3/OT1 (root cause candidate) → consolidated OT10
- B-G2 ↔ C-F3 (path drift family) → OT15
- B-G3/B-G4 ↔ subprocess robustness → OT16
- B-G7/B-G8 ↔ LD-S1 parity governance → OT18
