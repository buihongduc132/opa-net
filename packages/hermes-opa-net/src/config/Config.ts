/**
 * Fail-mode when the decision engine is unreachable [OT2 resolution].
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
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  // LD-G3: force cacheTtlMs=0 when unlock keys are present (cache poisoning guard).
  const cacheTtlMs = unlockKeys.length > 0 ? 0 : baseCacheTtlMs;

  // Salt path: PIOPANET_UNLOCK_SALT or PIOPANET_UNLOCK_SALT_FILE → default ~/.pi-opa-net/salt.
  const unlockSaltPath =
    ENV.PIOPANET_UNLOCK_SALT ?? ENV.PIOPANET_UNLOCK_SALT_FILE ?? defaultSaltPath();

  const unlockAgentId = ENV.PIOPANET_AGENT_ID;

  return {
    opaBinary: resolveOpaBinary(),
    policyPath,
    failMode,
    timeoutMs,
    cacheTtlMs,
    hostname: ENV.PI_OPA_HOSTNAME,
    sessionId: ENV.PI_OPA_SESSION_ID,
    unlockKeys,
    unlockSaltPath,
    unlockAgentId,
  };
}

/** Default salt file path: ~/.pi-opa-net/salt. */
function defaultSaltPath(): string {
  const home = ENV.HOME ?? process.env.HOME ?? '';
  return `${home}/.pi-opa-net/salt`;
}
