# Explore Turn 1 — troubleshoot `git commit --no-verify` not gated

> Date: 2026-08-09 (session start 2026-08-09T10:06:13Z; persisted 2026-08-15)
> Phase: troubleshooting (pre-explore-mode)
> Status: root cause found, no fix chosen

## Conversation

> **[user]** (verbatim — trust chain L1)
> troubleshoot why do we are still unable to gate the commit --no-verify

### [assistant] — investigation sequence

Tool calls + outputs reproduced as-is. Working directory at the time: `/home/bhd/Documents/Projects/bhd/pi-opa-net`.

```bash
ls -la && cat README.md 2>/dev/null | head -100
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

total 116
drwxrwxr-x  12 bhd  bhd   4096 Aug  9 17:06 .
drwxrwxr-x 205 bhd  bhd  12288 Aug  9 05:33 ..
drwxr-xr-x   2 bhd  bhd   4096 Jul  1 01:54 bin
-rw-rw-r--   1 bhd  bhd   4096 Jul  1 02:14 biome.json
-rw-rw-r--   1 bhd  bhd   2890 Jul  1 01:44 bun.lock
-rw-rw-r--   1 bhd   2890 Jul  1 06:36 CHANGELOG.md
-rw-rw-r--   1 bhd   1943 Jul  1 06:36 CONTRIBUTING.md
drwxrwxr-x   2 bhd  bhd  4096 Jul  1 01:43 docs
drwxrwxr-x   9 bhd  bhd  4096 Aug  9 17:06 .git
drwxrwxr-x   3 bhd  bhd  4096 Jul  1 06:37 .github
-rw-rw-r--   1 bhd  bhd    99 Jul  1 06:42 .gitignore
-rw-rw-r-- 1 root root   432 Aug  9 04:09 .gitnexusignore
-rw-rw-r--   1 bhd  bhd   1070 Jul  1 02:04 LICENSE
-rw-rw-r--   1 bhd  bhd    329 Jul  1 06:37 .npmignore
-rw-rw-r--   1 bhd  bhd   1751 Jul  1 06:35 package.json
-rw-rw-r--   1 bhd  bhd   7913 Jul  1 06:35 README.md
-rw-rwr-xr-x   2 bhd  bhd   4096 Jul  1 06:41 schemas
-rw-rw-r-xr-x   2 bhd  bhd  4096 Aug  9 17:06 .pi
-rw-rw-r--   2 bhd  bhd   4096 Jul  1 01:43 policy
-rw-rwr-xr-x 4 bhd  bhd   4096 Jul  1 01:43 src
drwxr-xr-x 4 bhd  bhd   4096 Jul  1 01:43 tests
-rw-rw-r-- 1 bhd  bhd   1613 Jul  1 06:36 SECURITY.md
-rw-rw-r-- 1 bhd  bhd   4096 Jul  1 06:36 SUPPORT.md
-rw-rw-r--   1 bhd  bhd   1613 Jul  1 06:36 SUPPORT.md
# pi-opa-net

[![npm version](https://img.shields.io/npm/v/pi-opa-net.svg)](https://www.npmjs.com/package/pi-opa-net)
[![CI](https://github.com/buihongduc132/pi-opa-net/actions/workflows/ci.yml/badge.svg)](https://github.com/buihongduc132/pi-opa-net/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/license/MIT-blue.svg)](./LICENSE)

> OPA-backed bash command guard for the [Pi](https://pi.dev) ecosystem. Structured `--json` output (decision-output.v1 schema), fail-open default, exit-code compatible with the Claude Code hook protocol.

An **agent-agnostic** engine + CLI that evaluates shell commands against an [OPA](https://www.openpolicyagent.org/)/Rego policy and emits a strict, auditable decision record. Designed as the decision backend for pi extensions, Claude Code hooks, scripts, and any agent that needs a uniform bash-guard contract.

## Why

Three limitations of today's asymmetric, agent-specific guard output that this fixes:

| # | Limitation | Fix |
|---|------------|-----|
| 1 | **Asymmetric** — allow is silent, deny emits a string | Both allow AND deny emit the full schema |
| 2 | **No provenance** — only a human message | `reasons[].rule_id` traces decision → rule → source line |
| 3 | **Agent-specific** — tied to one hook protocol | Agent-agnostic wrapper; adapters become thin views |

## Status

- **Stable:** v0.1.0 — schema v1.0, 37-rule catalog, full TDD coverage
- **Engine:** OPA 1.x (lazy-loaded on every dev box)
- **Scope:** bash command guarding only (see [`docs/locked-decisions.yaml`](docs/locked-decisions.yaml) LD3)
- **Pi extension:** the thin tool_call adapter lives in a separate future repo (`pi-opa-net-ext`, per OT5) — this package is the engine + library

## Installation

### Prerequisites

OPA 1.x on `PATH` (recommended via [mise](https://mise.jdx.dev)):

```bash
mise install opa@latest
mise use -g opa@latest
```

### Install

```bash
# as a library (pi extension / script consumer)
npm install pi-opa-net
# or
bun add pi-opa-net

# run the CLI directly via bun
bunx pi-opa-net eval "git stash pop"
```

## Usage

### CLI

```bash
# claude-code mode (default): suppress stdout on allow, JSON on deny
pi-opa-net eval "git stash pop"             # exit 2 + JSON on stdout
pi-opa-net eval "git stash list"            # exit 0, empty stdout

# --json: always emit the full decision-output.v1 schema
pi-opa-net eval "git stash pop" --json

# stdin
echo "docker stop foo" | pi-opa-net eval
```

**Exit codes:** `0 = allow`, `2 = deny` (Claude Code hook protocol compatible).

### Programmatic API

```ts
import { configFromEnv, CommandParserCoordination, OpaCliEngine, DecisionBuilder, OutputFormatter, RULES, RuleRegistry } from 'pi-opa-net';

const config = configFromEnv('/path/to/safety.rego');
const parser = new CommandParserCoordination();
const engine = new OpaCliEngine(config);
const builder = new DecisionBuilder({
  config,
  registry: new RuleRegistry(RULES),
  digest: engine.rulebookDigest(),
});

const parsed = parser.parse('git stash pop');
const engineDecision = await engine.evaluate(parsed);
const output = builder.build(parsed, engineDecision);

console.log(output.decision);  // 'deny'
console.log(output.reasons[0].rule_id);  // 'block-git-stash-mutations'
```

## Output schema

See [`schemas/decision-output.v1.json`](schemas/decision-output.v1.json) — JSON Schema draft 2020-12, strict (`additionalProperties: false` throughout). Every emitted record is validated against it before leaving the process.

```jsonc
{
  "schema_version": "1.0",
  "decision": "deny",            // allow | deny
  "action": "block",             // allow | block | prompt_user(v2) | log_only(v2)
  "source": "opa",               // opa | fail-open | fail-closed | cached
```

(Note: `ls -la` timestamps and a couple of transcribed lines above reflect the session view; content as seen.)

```bash
ls .git/hooks/ && cat .git/hooks/pre-commit 2>/dev/null || echo "No pre-commit hook"
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

applypatch-msg.sample
commit-msg.sample
fsmonitor-watchman.sample
post-update.sample
pre-applypatch.sample
pre-commit.sample
pre-merge-commit.sample
prepare-commit-msg.sample
pre-push.sample
pre-rebase.sample
pre-receive.sample
push-to-checkout.sample
sendemail-validate.sample
update.sample
No pre-commit hook
```

→ **finding: no pre-commit hook installed** in the local repo.

```bash
grep -n "no-verify\|no.verify\|commit" policy/safety.rego | head -40
```

```
18:#     subcommand: "commit" | "stash" | ""          (string; "" if none)
64:    input.subcommand == "commit"
66:    msg := "git commit -am stages ALL tracked modifications indiscriminately. Use explicit paths."
71:    input.subcommand == "commit"
72:    has_any_arg(input.args, ["--no-verify", "-n"])
73:    msg := "ALWAYS run pre-commit hooks. Bypassing hooks risks shipping broken changes."
97:    msg := "Hard reset discards local work and can remove others' uncommitted changes."
174:    msg := "Rebase rewrites commit history and is blocked in this environment."
```

```bash
sed -n '60,80p' policy/safety.rego
```

```
# ──────────────────────────────────────────────────────────────────

deny[msg] if {
    input.program == "git"
    input.subcommand == "commit"
    has_any_arg(input.args, ["-am", "-a"])
    msg := "git commit -am stages ALL tracked modifications indiscriminately. Use explicit paths."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "commit"
    has_any_arg(input.args, ["--no-verify", "-n"])
    msg := "ALWAYS run pre-commit hooks. Bypassing hooks risks shipping broken changes."
}

deny[msg] if {
    input.program == "git"
    input.subcommand == "stash"
    has_any_arg(input.args, ["push", "pop", "drop", "clear", "store", "create", "save"])
    msg := "Do not mutate stashes in shared work. Others may be relying on them."
```

```bash
bun run src/cli/index.ts eval "git commit --no-verify" --json 2>&1 | head -40; echo "exit: $?"
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

[0m[31merror[0m[2m:[0m [1mModule not found "[1msrc/cli/index.ts[0m"
exit: 0
```

```bash
ls src/cli/ && cat package.json | grep -A5 '"bin"\|"main"\|"scripts"'
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

run.ts
  "main": "src/index.ts",
  "types": "src/index.ts",
  "bin": {
    "pi-opa-net": "bin/pi-opa-net.js"
  },
  "files": [
    "src",
    "bin",
    "schemas",
    "policy",
    "skills",
    "README.md",
    "CHANGELOG.md",
--
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "biome check --write src tests bin",
    "lint:ci": "biome ci src tests bin",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
```

```bash
bun run bin/pi-opa-net.js eval "git commit --no-verify" --json 2>&1; echo "exit: $?"
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

  🔍 Resolving [2/2] [23D[0K  🔍 Resolving [17/16] [25D[0K  🔍 Resolving [18/20] [25D[0K  🔍 Resolving [21/20] [25D[0K{"schema_version":"1.0","decision":"deny","action":"block","source":"opa","reasons":[{"rule_id":"block-git-commit-no-verify","message":"ALWAYS run pre-commit hooks. Bypassing hooks risks shipping broken changes.","family":"git","severity":"block"}],"input":{"raw":"git commit --no-verify","program":"git","subcommand":"commit","args":["--no-verify"],"parse_confidence":"full"},"summary":"BLOCKED: git commit --no-verify (rule: block-git-commit-no-verify)","suggestions":[],"metadata":{"engine":"opa","opa_version":"1.18.2","rulebook_digest":"943e468a4f53","policy_path":"/home/bhd/Documents/Projects/bhd/pi-opa-net/policy/safety.rego","hostname":"bhd-main2","session_id":""},"evaluated_at":"2026-08-09T10:07:11.673Z","decision_id":"d24638d3-b779-43b2-80d3-f0692ee6c73e","duration_ms":14}
exit: 2
```

→ **CLI deny path works. Rule exists. Exit 2.**

```bash
env | grep -iE "opa|guard|bash|safety|policy" | sort; echo '---'; echo "PI_BASH_GUARD_CFG: $PI_BASH_GUARD_CFG"; echo "PI_SAFETY_REGO: $PI_SAFETY_REGO"
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

OLDPWD=/home/bhd/Documents/Projects/bhd/pi-opa-net
PATH=/home/bhd/.pi/agent/bin:/home/bhd/.local/share/mise/installs/node/22.22.2/bin:/home/bhd/bin:... (mise paths incl. opa/1.18.2) ...:/bin:/usr/games:/usr/local/games:/snap/bin:/home/bhd/google-cloud-sdk/bin:/home/bhd/.fly/bin:/home/bhd/.local/share/pnpm:/home/bhd/.fly/bin:/home/bhd/.nvm/versions/node/v22.22.2/bin:/home/bhd/.pyenv/bin:/home/bhd/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PI_SESSION_FILE=/home/bhd/.pi/agent/sessions/--home-bhd-Documents-Projects-bhd-pi-opa-net--/2026-08-09T10-06-13-908Z_019fe5fc-bd94-7a0e-924a-c0f3ac8d021d.jsonl
PWD=/home/bhd/Documents/Projects/bhd/pi-opa-net
---
PI_BASH_GUARD_CFG: 
PI_SAFETY_REGO: 
```

```bash
ls ~/.pi/agent/ 2>/dev/null | head; echo '---'; find ~/.pi/agent -maxdepth 3 -iname '*bash-guard*' 2>/dev/null | head; echo '---OPA-NET-EXT---'; find ~/.pi/agent -maxdepth 4 -iname '*opa-net*' 2>/dev/null | head
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

acp-agents
agent
agents
AGENTS.md
APPEND_SYSTEM.md
auth.json
auth.json.bak-subrouter-1786089741
banned-packages.txt
bin
cc-safety-net
---
/home/bhd/.pi/agent/extensions/pi-bash-guard
/home/bhd/.pi/agent/extensions/pi-bash-guard/pi-bash-guard.example.json
---
/home/bhd/.pi/agent/npm/node_modules/.bin/pi-opa-net
/home/bhd/.pi/agent/npm/node_modules/pi-opa-net
/home/bhd/.pi/agent/session-progress/_home_bhd_.pi_agent_sessions_--home-bhd-Documents-Projects-bhd-pi-opa-net--_2026-08-09T10-06-13-908Z_019fe5fc-bd94-7a0e-924a-c0f3ac8d021d.jsonl.json
/home/bhd/.pi/agent/sessions/--home-bhd-Documents-Projects-bhd-pi-opa-net--
```

→ **pi-bash-guard extension found. pi-opa-net installed via npm only.**

```bash
ls ~/.pi/agent/extensions/pi-bash-guard/ && echo '---CONFIG---' && cat ~/.pi/agent/extensions/pi-bash-guard/*.json 2>/dev/null | head -50
```

```
[pi-bash-guard] ...preamble...

bin
config.ts
matcher.ts
node_modules
package.json
package-lock.json
pi-bash-guard.example.json
REQUIREMENTS.md
tests
tsconfig.json
vitest.config.ts
---
{
  "name": "pi-bash-guard",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "description": "Pi extension that intercepts bash tool calls — group-based block/append/timeout rules with per-group config and AI-visible hint messages.",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "@types/node": "^24.9.1",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
{ ...package-lock.json head (vitest toolchain deps, elided names as pasted)... }
```

```bash
cat ~/.pi/agent/extensions/pi-bash-guard/pi-bash-guard.example.json
```

```
[pi-bash-guard] ...preamble...

{
  "_comment": "Drop this at <cwd>/.pi-bash-guard.json (project) or ~/.config/pi-bash-guard/config.json (global). $PI_BASH_GUARD_CONFIG=/abs/path overrides both. First-matching group wins; the matched group's effects compose (block / allow / prependArgs / appendArgs / timeoutSec — any subset). Omit top-level keys to inherit built-in defaults.",

  "enabled": true,
  "defaultTimeoutSec": 300,
  "maxTimeoutSec": 1800,
  "nonInteractiveEnv": true,

  "groups": [
    {
      "name": "git-interactive",
      "match": [
        "^\\s*git\\s+rebase\\s+-i\\b",
        "^\\s*git\\s+commit(?=\\s|$)(?!.*(?:\\s-[a-zA-Z]*[mF]\\b|--message\\b|--file\\b|--no-edit\\b))"
      ],
      "block": true,
      "reason": "Interactive git not supported (agent has no TTY/editor). Use --no-edit, GIT_SEQUENCE_EDITOR=true, or pass -m."
    },

    {
      "name": "vitest-with-cap",
      "match": ["\\bvitest\\b(?!.*(--run|--watch=false))"],
      "appendArgs": " --run",
      "timeoutSec": 600,
      "reason": "Force single-run mode AND cap at 10 minutes — two effects on one group."
    },

    {
      "name": "long-builds",
      "match": ["\\bbun\\s+(run\\s+)?build\\b", "\\bnpm\\s+run\\s+build\\b"],
      "timeoutSec": 900,
      "reason": "Build timeout capped at 15 minutes."
    },

    {
      "name": "trusted-mise-tasks",
      "match": ["^\\s*mise\\s+run\\s+(test|build|lint)\\b"],
      "allow": true,
      "reason": "Trusted mise tasks — skip default timeout and env preamble."
    },

    {
      "_comment": "Idle-extend wraps the command in `bun bin/idle-wrap.ts <idle> <hard> -- bash -c '<cmd>'`. Each byte of stdout/stderr resets a `<idle>`s kill timer; if no output for `<idle>` seconds the wrapper sends SIGTERM and exits 124. The wrapper also enforces a hard cap at `timeoutSec`, exiting 137 if reached. Groups with idleTimeoutSec are EXEMPT from the global maxTimeoutSec — the idle mechanism IS the safety net. timeoutSec is REQUIRED when idleTimeoutSec is set.",
      "name": "healer-procs-example",
      "match": [
        "\\bnomad\\s+job\\s+run\\b",
        "\\bdocker\\s+compose\\s+(?:up|restart)\\b",
        "\\bmise\\s+run\\s+\\S*__deploy\\b"
      ],
      "timeoutSec": 7200,
      "idleTimeoutSec": 15,
      "reason": "Long-running healer/ops process — 15s output-idle window, 2h hard cap. Exit 124 = idle kill, 137 = hard-cap kill."
    }
  ]
}
```

```bash
ls -la .pi-bash-guard.json .pi/ 2>/dev/null; echo '---GLOBAL---'; ls -la ~/.config/pi-bash-guard/ 2>/dev/null; echo '---SEARCH---'; find ~ -maxdepth 4 -name 'pi-bash-guard*.json' 2>/dev/null | grep -v node_modules | grep -v example | head
```

```
[pi-bash-guard] ...preamble...

.pi/:
total 12
drwxrwxr-x  2 bhd  bhd   4096 Aug  9 17:06 .
drwxrwxr-x 12 bhd  bhd  4096 Aug  9 17:06 ..
-rw-rw-r--  1 bhd  bhd    134 Aug  9 17:06 print-clean-exit-trace.jsonl
---
(empty — no project/global config found)
```

→ **pi-bash-guard running on built-in DEFAULT groups.**

Then read `~/.pi/agent/extensions/pi-bash-guard/config.ts` in full (DEFAULT_GROUPS: git-interactive, vitest-watch-explicit, vitest-watch, jest-watch-explicit, jest-watch, long-builds, healer-procs; DEFAULTS: enabled=true, defaultTimeoutSec=300, maxTimeoutSec=1800, nonInteractiveEnv=true; loadConfig precedence: `$PI_BASH_GUARD_CONFIG` → `<cwd>/.pi-bash-guard.json` → `~/.config/pi-bash-guard/config.json` → defaults; groups REPLACE not merge) and `matcher.ts` head (decision function: block short-circuits; prepend/append rewrite; timeoutSec ceiling; envPreamble; allow).

Then a Bun regex test against the DEFAULT `git-interactive` commit pattern:

```bash
bun .tmp-guard-test.mjs
```

```
[pi-bash-guard] default timeout 300s applied (model omitted; no group matched).
[pi-bash-guard] non-interactive env preamble prepended (closes editor/pager prompts).
────────────────────────────────────────────────────────────

BLOCK "git commit --no-verify"
PASS  "git commit --no-verify -m msg"
PASS  "git commit -m \"msg\" --no-verify"
PASS  "git commit -n -m msg"
PASS  "git commit --no-verify --no-edit"
```

```bash
grep -rn "opa-net\|pi-opa\|safety.rego\|OpaCli\|opa eval" ~/.pi/agent/extensions/pi-bash-guard/ ~/.pi/agent/settings.json ~/.pi-staging/settings.json ~/.pi-dev-*/settings.json 2>/dev/null | grep -v node_modules | grep -v Binary | head -20; echo '---done---'
```

```
/home/bhd/.pi/agent/settings.json:60:    "npm:pi-opa-net",
/home/bhd/.pi-staging/settings.json:60:    "npm:pi-opa-net",
/home/bhd/.pi-dev-pi-plugins/settings.json:60:    "npm:pi-opa-net",
---done---
```

→ **pi-bash-guard never references pi-opa-net. pi-opa-net appears in settings.json as an install entry only.**

### [assistant] — final answer (as-is)

**[R1]** NO. Not gating. `pi-opa-net` policy never runs on real bash.

**Root cause [C1]:** Two disconnected guards.
- `pi-bash-guard` (regex-group hook, ACTIVE — the `[pi-bash-guard]` prefix on every cmd) does NOT call pi-opa-net.
- `pi-opa-net` (Rego, blocks `--no-verify` rule `block-git-commit-no-verify`) — only invoked via `pi-opa-net eval`. Nothing wires it into the bash hook.

Evidence [E1]:
- `policy/safety.rego:71-73` has the rule, CLI self-test returns `deny/exit 2` ✓
- `~/.pi/agent/settings.json:60` lists `npm:pi-opa-net` = **install only**, no caller
- `grep opa ~/.pi/agent/extensions/pi-bash-guard/` → **zero** references

**Root cause [C2]:** Even if wired, pi-bash-guard's DEFAULT `git-interactive` regex leaks the common form.

Regex (`config.ts`): `git commit` UNLESS it has `-m|-F|--message|--file|--no-edit`. `--no-verify` not in exemption, but `-m` IS:

| cmd | pi-bash-guard |
|-----|---------------|
| `git commit --no-verify` | BLOCK |
| `git commit --no-verify -m x` | **PASS** ← real form |
| `git commit -m x --no-verify` | **PASS** |
| `git commit -n -m x` | **PASS** |
| `git commit --no-verify --no-edit` | **PASS** |

Fix paths (pick one) [F1]:
- **A — wire pi-opa-net into the hook** (intended design, OT5): build `pi-opa-net-ext` that calls `pi-opa-net eval` on every bash tool_call; pi-bash-guard delegates or is replaced. Then Rego rule lives.
- **B — patch pi-bash-guard default** (quick): add group `block-git-no-verify` with `match: ["^\\s*git\\s+commit\\b.*(?:--no-verify\\b|\\s-[a-zA-Z]*n\\b)"]`, `block:true`.

Callouts [CA1]:
- [C1] = architecture gap, not a bug. pi-opa-net README §Status: "Pi extension: the thin tool_call adapter lives in a separate future repo (`pi-opa-net-ext`)" — **still unbuilt**. So by-design not gating anything yet.
- [C2] = real leak. `git commit -m x --no-verify` is the actual bypass today.
- Doing [F2] alone = patching the wrong layer long-term; [F1] is the intended fix but [F2] unblocks now.

Assumptions [A]:
- "gate" = block the commit. If you mean something else (e.g. pi-bash-guard SHOULD block but doesn't), confirm.
- Verified pi-opa-net CLI deny path works; NOT verified any pi session routes bash through it (found none).

Which fix — A or B?

## Status at end of turn 1

Root cause identified (two disconnected guards + regex leak in active guard). No fix chosen. → See turn 2 for replacement-status question.
