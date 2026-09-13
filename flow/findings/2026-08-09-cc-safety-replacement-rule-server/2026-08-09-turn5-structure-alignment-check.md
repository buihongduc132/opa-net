# Explore Turn 5 — does the proposed server align with ../opa-net structure?

> Date: 2026-08-09
> Phase: explore mode (ospx step 10) — structural alignment check
> Status: answered NO; one existing seam (OTLP audit sink) but wrong direction

## Conversation

> **[user]** (verbatim — trust chain L1)
> DId that aligned with the structure of the opa-net yet?

### [assistant] — investigation sequence

```bash
sed -n '1,60p' ../opa-net/src/engine/OpaCliEngine.ts
```

```
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EngineConfig } from '../config/Config.ts';
import type { ParsedCommand } from '../parser/types.ts';
import type { Signals } from '../signals/types.ts';
import { sha256Prefix } from '../util/digest.ts';
import type { DecisionEngine, EngineDecision, RawDeny } from './types.ts';

const execFileAsync = promisify(execFile);

/**
 * OPA-backed decision engine via the `opa eval` CLI subprocess [LD1][LD2].
 *
 * - Spawns `opa eval -d <policy> -i <input.json> data.safety.allow + data.safety.deny`.
 * - On timeout / non-zero exit / unreachable binary → applies [OT2] fail-mode.
 * - fail-open: returns allow with source=fail-open.
 * - fail-closed: returns deny with source=fail-closed.
 *
 * Rego returns `deny` as a set of message strings; we map each to a RawDeny.
 */
export class OpaCliEngine implements DecisionEngine {
  readonly name = 'opa-cli';
  private readonly config: EngineConfig;
  private readonly digest: string;
  private readonly opaVersion: string;

  constructor(config: EngineConfig, opaVersion = '') {
    this.config = config;
    this.digest = sha256Prefix(this.config.policyPath, this.readFile);
    this.opaVersion = opaVersion;
  }

  async evaluate(parsed: ParsedCommand, signals?: Signals): Promise<EngineDecision> {
    const input: Record<string, unknown> = {
      program: parsed.program,
      subcommand: parsed.subcommand,
      args: parsed.args,
      raw: parsed.raw,
    };

    // Merge signals into input if provided.
    if (signals) {
      input.signals = signals;
    }

    const inputJson = JSON.stringify(input);
    const query = '{"allow": data.safety.allow, "deny": data.safety.deny}';
    const args = ['eval', '--format', 'json', '-d', this.config.policyPath];

    // Build data bundle with config (allowed_branches, worktree_allowed_dirs).
    const dataBundle: Record<string, unknown> = {};
    if (this.config.allowedBranches) {
      dataBundle.config = {
        allowed_branches: this.config.allowedBranches,
        worktree_allowed_dirs: this.config.worktreeAllowedDirs ?? [],
      };
    }
```

```bash
sed -n '1,80p' ../opa-net/src/config/Config.ts
```

```
/** Fail-mode when the decision engine is unreachable [OT2 resolution].
 * - `open`: allow the command through (default — matches pi-safety-net fork).
 * - `closed`: block the command until engine responds.
 */
export type FailMode = 'open' | 'closed';

/** Cache TTL in ms. 0 disables caching. */
export const DEFAULT_CACHE_TTL_MS = 0;

export interface EngineConfig {
  /** Path to the OPA binary. If unset, auto-discovered via PATH + mise. */
  readonly opaBinary?: string;
  /** Path to the .rego policy bundle. */
  readonly policyPath: string;
  /** Fail-mode when OPA is unreachable [OT2]. */
  readonly failMode: FailMode;
  /** Milliseconds to wait for OPA before treating as unreachable. */
  readonly timeoutMs: number;
  /** Cache TTL for identical inputs. 0 = disabled. */
  readonly cacheTtlMs: number;
  /** Hostname for metadata. Defaults to os.hostname(). */
  readonly hostname?: string;
  /** Calling session ID for metadata (pi/claude session). Empty if none. */
  readonly sessionId?: string;
  /** Unlock keys from PIOPANET_UNLOCK_KEYS / --unlock (comma-separated env). */
  readonly unlockKeys?: readonly string[];
  /** Path to the deploy-local salt file (or PIOPANET_UNLOCK_SALT override). */
  readonly unlockSaltPath?: string;
  /** Agent ID for unlock audit metadata (PIOPANET_AGENT_ID). */
  readonly unlockAgentId?: string;
  /** Allowed branches for branch-target-allowlist rule (LD1). Default: dev,staging,main,master. */
  readonly allowedBranches?: readonly string[];
  /** Allowed prefixes for worktree-path-allowlist rule (LD3). Default: .worktrees,worktrees,~/.config/superpowers/worktrees. */
  readonly worktreeAllowedDirs?: readonly string[];
}

const ENV = process.env;

/** Resolve the OPA binary path: explicit → PATH → mise install. */
export function resolveOpaBinary(explicit?: string): string {
  if (explicit) return explicit;
  if (ENV.PI_OPA_BINARY) return ENV.PI_OPA_BINARY;
  // mise install path (LD2: OPA lazy-loaded on every dev box).
  const misePath = `${process.env.HOME}/.local/share/mise/installs/opa`;
  try {
    const versions = readdirSafe(misePath);
    // Prefer the most specific semver; fall back to 'latest'.
    const pick =
      versions
        .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
        .sort()
        .at(-1) ?? 'latest';
    const candidate = `${misePath}/${pick}/opa`;
    return candidate;
  } catch {
    return 'opa';
  }
}

function readdirSafe(path: string): string[] {
  try {
    // Lazy require to avoid fs cost in non-Node runtimes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readdirSync(path);
  } catch {
    return [];
  }
}

/** Build an EngineConfig from environment + defaults. */
export function configFromEnv(policyPath: string): EngineConfig {
  const failMode: FailMode = (ENV.PI_OPA_FAIL_MODE as FailMode) === 'closed' ? 'closed' : 'open';
  const timeoutMs = ENV.PI_OPA_TIMEOUT_MS ? Number.parseInt(ENV.PI_OPA_TIMEOUT_MS, 10) : 250;
  const baseCacheTtlMs = ENV.PI_OPA_CACHE_TTL_MS
    ? Number.parseInt(ENV.PI_OPA_CACHE_TTL_MS, 10)
    : DEFAULT_CACHE_TTL_MS;

  // Unlock keys: PIOPANET_UNLOCK_KEYS (comma-separated, trimmed).
  const unlockKeys = (ENV.PIOPANET_UNLOCK_KEYS ?? '')
```

```bash
cat ../opa-net/src/index.ts
```

```
// Public API for pi-opa-net — agent-agnostic engine + structured output.
//
// Consumers: pi extension (future pi-opa-net-ext), scripts, other agents.
// CLI entrypoint lives in src/cli/run.ts.

export { configFromEnv, resolveOpaBinary } from './config/Config.ts';
export type { EngineConfig, FailMode } from './config/Config.ts';

export { CommandParserCoordinator, RegexFallbackParser, ShellQuoteParser } from './parser/index.ts';
export type { CommandParser, ParseConfidence, ParsedCommand } from './parser/index.ts';

export { OpaCliEngine, probeOpaVersion } from './engine/index.ts';
export type { DecisionEngine, EngineDecision, RawDeny } from './engine/index.ts';

export { RULES, RuleRegistry, inferFamilyFromProgram } from './rules/index.ts';
export type { RuleFamily, RuleMeta } from './rules/index.ts';

export {
  DecisionBuilder,
  OutputFormatter,
  isValidDecision,
  validateDecision,
} from './output/index.ts';
export type {
  DecisionMetadata,
  DecisionOutput,
  EvaluatedInput,
  OutputMode,
  Reason,
} from './output/index.ts';

export { sha256Prefix } from './util/digest.ts';
```

```bash
cat ../opa-net/src/audit/sinkFactory.ts
```

```
/**
 * Config-driven audit sink factory [LD-Y2 sink seam].
 *
 * Decides which sink(s) to wire based on environment:
 *   - PIOPANET_OTEL_ENABLED=1 + PIOPANET_OTEL_ENDPOINT → MultiSink(filesystem + OTLP)
 *   - PIOPANET_OTEL_ENABLED=1 + no endpoint            → filesystem only (stderr warn)
 *   - otherwise                                        → filesystem only (backward compat)
 *
 * This keeps OPA keys out of config (keys live in audit records) and preserves
 * the existing filesystem-only behavior when OpenTelemetry is disabled.
 */
import { createFilesystemAuditSink } from '../pi/audit.ts';
import type { AuditSink } from '../pi/audit.ts';
import { MultiSink } from './MultiSink.ts';
import { OtlpAuditSink } from './OtlpAuditSink.ts';

export interface CreateAuditSinkOptions {
  /** Working directory used by the filesystem sink. */
  readonly cwd: string;
  /** Environment source. Defaults to process.env when omitted. */
  readonly env?: NodeJS.ProcessEnv;
}

const DEFAULT_SERVICE_NAME = 'pi-opa-net';

/**
 * Parse a 'k=v,k2=v2' header string into a Record. Whitespace tolerated.
 */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue; // skip malformed / empty-key entries
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key.length > 0) out[key] = val;
  }
  return out;
}

/**
 * Build the audit sink stack from environment. When OpenTelemetry is enabled
 * AND an endpoint is configured, returns a MultiSink fanning out to both the
 * filesystem sink and the OTLP sink. Otherwise returns the filesystem sink
 * alone, preserving the pre-OTel behavior.
 */
export function createAuditSink(opts: CreateAuditSinkOptions): AuditSink {
  const env = opts.env ?? process.env;
  const fsSink = createFilesystemAuditSink(opts.cwd);

  const otelEnabled = env.PIOPANET_OTEL_ENABLED === '1';
  const endpoint = env.PIOPANET_OTEL_ENDPOINT;
  if (!otelEnabled || !endpoint) {
    if (otelEnabled && !endpoint) {
      console.error(
        '[pi-opa-net] PIOPANET_OTEL_ENABLED=1 but PIOPANET_OTEL_ENDPOINT unset; falling back to filesystem audit only',
      );
    }
    return fsSink;
  }

  const serviceName = env.PIOPANET_OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
  const headers = parseHeaders(env.PIOPANET_OTEL_HEADERS);
  const otlpSink = new OtlpAuditSink({ endpoint, serviceName, headers });
  return new MultiSink([fsSink, otlpSink]);
}
```

```bash
sed -n '1,50p' ../opa-net/src/audit/OtlpAuditSink.ts
```

```
/**
 * OpenTelemetry (OTLP/HTTP) audit sink [LD-Y2 sink seam].
 *
 * Implements the pi `AuditSink` interface (`{ write }` from src/pi/audit.ts)
 * and POSTs an OTLP Logs JSON document to a collector endpoint. OTLP-over-HTTP
 * is the canonical transport for logs (see OTel spec). Network failure is
 * non-fatal: write() catches and resolves, mirroring the filesystem sink's
 * graceful-degradation contract.
 *
 * Keys never enter OPA, and secrets are redacted upstream (src/pi/audit.ts)
 * before reaching this sink; this layer performs no redaction itself.
 */
import type { AuditSink } from '../pi/audit.ts';

export interface OtlpAuditSinkOptions {
  /** OTLP/HTTP logs endpoint, e.g. http://otel:4318/v1/logs. */
  readonly endpoint: string;
  /** service.name resource attribute. Default 'pi-opa-net'. */
  readonly serviceName?: string;
  /** Extra request headers (auth, tenant, ...). */
  readonly headers?: Record<string, string>;
}

/** Shape produced by writeAuditEntry (src/pi/audit.ts AuditEntry). */
type AuditEntry = {
  readonly decision_id?: string;
  readonly decision?: string;
  readonly source?: string;
  readonly command?: string;
  readonly rule_ids?: readonly string[];
  readonly evaluated_at?: string;
  readonly pi_opa_net_version?: string;
  readonly [k: string]: unknown;
};

/** OTLP any-value helper. */
function stringValue(v: unknown): { stringValue: string } {
  return { stringValue: typeof v === 'string' ? String(v ?? '') };
}

/**
 * OTLP/HTTP audit sink. POSTs each decision as an OTLP Logs logRecord.
 */
export class OtlpAuditSink implements AuditSink {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly headers: Record<string, string>;

  constructor(opts: OtlpAuditSinkOptions) {
    this.endpoint = opts.endpoint;
```

### [assistant] — final answer (as-is)

**No.** The proposed server does NOT align with `../opa-net`'s current structure. One seam exists, but it's the wrong direction.

## Structural alignment check

```
┌─────────────────────────────────────────────────────────────────┐
│  ../opa-net STRUCTURE vs PROPOSED SERVER                        │
├──────────────────────────┬──────────┬───────────────────────────┤
│ Seam                     │ Exists?  │ Aligned with server?      │
├──────────────────────────┼──────────┼───────────────────────────┤
│ Rule source (file/URL)   │  ❌ NO   │ Engine hardcoded to local │
│   abstraction            │          │ file path. No URL knob.   │
│                          │          │                           │
│ EngineConfig.rulesUrl    │  ❌ NO   │ Only `policyPath` (file)  │
│ PIOPANET_RULES_URL env   │  ❌ NO   │ Not in configFromEnv()    │
│ Rego fetch+cache layer   │  ❌ NO   │ Only decision cache exists│
│ HTTP listener (server)   │  ❌ NO   │ Package is client-only    │
│                          │          │                           │
│ Audit OTLP/HTTP sink     │  ✅ YES  │ ⚠️ WRONG DIRECTION        │
│   (OtlpAuditSink)        │          │ (egress, not ingress)     │
│                          │          │                           │
│ Unlock-key SaltResolver  │  ⚠️ HALF │ Local-file now; "remote   │
│                          │          │ later" planned in README  │
└──────────────────────────┴──────────┴───────────────────────────┘
```

## The hard constraint

`OpaCliEngine` is structurally **local-file-bound**:

```ts
// ../opa-net/src/engine/OpaCliEngine.ts
constructor(config: EngineConfig, ...) {
  this.digest = sha256Prefix(this.config.policyPath, this.readFile);
  //                                ^^^^^^^^^^^^ local FILE PATH
}

async evaluate(parsed, signals) {
  const args = ['eval', '--format', 'json', '-d', this.config.policyPath];
  //                                                  ^^^^^^^^^^^^^^^^^^^
  //                                                  passed to local `opa` CLI
}
```

`policyPath` is a filesystem path handed to `opa eval -d <path>`. There is **no seam** where you could swap "local file" for "fetched blob" without touching the engine constructor + config shape.

## The one existing seam — and why it's not enough

```
   CLIENT (pi-opa-net today)              SERVER (proposed)
  ┌──────────────────────┐              ┌──────────────────┐
  │                      │              │                  │
  │  ┌────────────────┐  │   POST       │  OTLP collector  │
  │  │ OtlpAuditSink  │─────egress─────▶│  (ingests audit) │
  │  └────────────────┘  │              │                  │
  │         ✅ EXISTS    │              │   ❌ doesn't      │
  │                      │              │      exist       │
  │  ┌────────────────┐  │              │                  │
  │  │  RuleSource    │  │   GET        │  Rule server     │
  │  │  (missing)     │◀────ingress─────│  (serves rego)   │
  │  └────────────────┘  │              │                  │
  │         ❌ MISSING   │              │   ❌ doesn't      │
  │                      │              │      exist       │
  └──────────────────────┘              └──────────────────┘
```

The audit sink proves the package **can** do HTTP egress — but it's one-way (decision records OUT, not rules IN). Serving rules needs the **opposite** direction, which requires new abstractions:

| Needed for "rules from server" | Status |
|---|---|
| `RuleSource` interface (file \| http \| bundle) | **MISSING** |
| `EngineConfig.policyUrl` + `PIOPANET_RULES_URL` | **MISSING** |
| Fetch + TTL cache + integrity digest check | **MISSING** (only `sha256Prefix` digest util exists) |
| Fallback-to-bundled-when-server-down | **MISSING** (fail-mode covers eval failure, not fetch failure) |
| Server process (listener, routes, auth) | **MISSING** — and arguably belongs in a NEW repo, not this package |
| LD2 amendment ("NOT remote" → "remote with local fallback") | **REQUIRED** — locked decision currently forbids it |

## What this means for "remaining to do"

My previous answer's server section was **aspirational**, not structural. To make "rules from server" actually fit `../opa-net`, the real remaining work is:

```
1. Add RuleSource seam (interface + file impl + http impl)
   - Engine takes RuleSource, not policyPath
   - Backward-compat: file source = current behavior

2. Extend EngineConfig + configFromEnv
   - policyUrl?: string
   - PIOPANET_RULES_URL, PIOPANET_RULES_TTL_MS, PIOPANET_RULES_TOKEN

3. Cache layer (fetched rego → disk → sha verify → feed to opa)
   - Reuse sha256Prefix for integrity
   - Honors fail-mode on fetch failure (open = bundled fallback)

4. Decide server home
   - (a) New repo `opa-net-server` (clean separation, matches OT5 pattern)
   - (b) Inside ../opa-net as a second bin (e.g. `pi-opa-net serve`)
   - (c) Fold into existing infra (Nomad? Caddy? noco-mesh?)

5. Amend LD2
   - "OPA binary stays local; rego POLICY can be remote-served with cache"
   - Or split: LD2a (binary local, locked) + LD2b (policy remote, new)
```

**The audit-sink seam is the only reusable pattern** — it already does HTTP, headers, graceful degradation, env-driven factory. A `RemoteRuleSource` could mirror `OtlpAuditSink`'s shape almost exactly.

---

Want me to sketch the `RuleSource` interface shape (the minimal seam that unblocks everything without breaking LD2's local-binary guarantee), or dig into where the server should live first?

## Status at end of turn 5

Structural alignment answered NO. Five concrete work items identified (RuleSource seam, config extension, cache, server home decision, LD2 amendment). Explore ongoing — awaiting user direction on next thread.
