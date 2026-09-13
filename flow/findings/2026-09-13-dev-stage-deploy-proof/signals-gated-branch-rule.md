# Verifier round-2 note — signals-gated branch rule is by design

Round-2 verifier d2 probed bare `pi-opa-net eval "git checkout feature-x" --json`
from a non-repo cwd and got ALLOW, reading it as "required DENY unproven".

This is **by design**, not a gap: `branch-target-allowlist` is a signals-gated
conditional rule (PR #2 design — "conditional branch gate"). It fires ONLY when
the TS-side SignalCollector supplies repo context (`signals.repo.is_main_worktree`
etc.), which requires the eval to run inside a git repo (cwd or -C target).
A bare CLI eval outside a repo supplies no signals — the rule intentionally
does NOT fire (fail-open default), exactly like the other signals-gated rules.

The DENY path is proven with real repos in
`tests/e2e/worktree-gating-e2e.test.ts` (fixture repos, cwd-propagated signals,
PIOPANET_ALLOWED_BRANCHES cases (a)–(m), all green) — not by bare-CLI probes.
