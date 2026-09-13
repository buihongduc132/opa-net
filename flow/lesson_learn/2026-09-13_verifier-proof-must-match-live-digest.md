# LSL: verifier rejects stale proof artifacts (digest/plan/status mismatch)

## Context
Jewilo rounds 2–7 kept REJECTING after the code was green, each time on a *documentation/artifact* lie:
- `session-result-lines.txt` contained both ALLOWED and BLOCKED for the same command (prompt echo + final message).
- `allow-probes-cli.json` recorded `rulebook_digest 92827bc` after policy moved to `8608613d`.
- Plan `ban-shallow-heavy-scan.md` still said `staging:todo - prod:todo` / `Last reconciled: 2026-09-09` after prod was done.
- Bare CLI branch probe (no signals) claimed the allowlist unproven.
- Dev 0.6.0 drift vs README claiming 0.7.0.

## Solutions
- Extract RESULT lines from the **final assistant message only**, not the whole transcript.
- Re-run CLI probes against the *current* installed package after every policy change; overwrite JSON with the new digest.
- Flip plan checkboxes and Deployment/Last-reconciled in the same commit as the deploy they describe. Out-of-scope stages get `not-in-goal-scope`, not `todo`.
- Persist machine-written audit JSONL (decision_id, rule_ids, version, digest) as the source of truth; README is a table over those files.

## Gotchas
- Verifiers will sha256 proof JSON vs live `node_modules` vs source. A 3-hour-old allow-probes file is a reject even if the live tree is correct.
- `staging:todo` when staging was never in the goal is still an untruthful artifact.
- Prompt-echo of `RESULT|1|…|ALLOWED_OR_BLOCKED` must not be grepped as outcomes.

## Ref
flow/findings/2026-09-13-dev-stage-deploy-proof/
flow/plans/ban-shallow-heavy-scan.md
