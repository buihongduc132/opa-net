# Security Policy

## Supported versions

Only the latest minor release line receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email the maintainer directly: **buihongduc132@gmail.com**

Include:
- A description of the issue and its impact
- Steps to reproduce (proof of concept if possible)
- Affected versions

You will receive an acknowledgment within 72 hours. Please do not disclose the issue publicly until a fix is released.

## Security posture

- **Fail-open by default** — when OPA is unreachable, commands are allowed through (matching the `pi-safety-net` fork's "never brick the shell" guarantee). Use `PI_OPA_FAIL_MODE=closed` for environments that must fail-closed.
- **No network calls** — the engine shells out to a local `opa` binary only. No telemetry, no phone-home, no remote policy fetch.
- **Strict output schema** — every emitted decision record is validated against `decision-output.v1.json` (draft 2020-12, `additionalProperties: false`) before leaving the process.
- **No secret redaction in the record** — `input.raw` stores the command verbatim (consumers are trusted). Redact at the display layer if commands may carry secrets.

## Threat model

This package is a **local decision engine**, not a security boundary on its own. It evaluates commands against a policy and reports a decision. The caller (pi extension, Claude Code hook, script) is responsible for **enforcing** the decision (blocking the command on `deny`). A consumer that ignores the exit code or `decision: "deny"` gets no protection.
