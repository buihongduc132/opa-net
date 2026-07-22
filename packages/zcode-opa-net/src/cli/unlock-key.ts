import { RULES } from '../rules/index.ts';
import { KeyDerivation } from '../unlock/KeyDerivation.ts';
import { SaltResolver } from '../unlock/SaltResolver.ts';

/** Options for minting an unlock key. */
export interface MintUnlockKeyOptions {
  /** Rule ID to mint a key for. Must be in the catalog. */
  readonly ruleId: string;
  /** Path to the salt file (auto-generates if missing). */
  readonly saltPath?: string;
  /** Direct salt buffer (bypasses SaltResolver — for testing). */
  readonly salt?: Buffer;
  /** TTL in seconds. Omit for a long-lived key. */
  readonly ttlSec?: number;
}

/**
 * Mint an unlock key for a catalog-registered rule_id [D3].
 *
 * - Long-lived: `ll_<16hex>` where mac = HMAC(salt, rule_id).
 * - TTL: `ttl.<exp>.<16hex>` where exp = floor(now/1000) + ttlSec,
 *   mac = HMAC(salt, rule_id + '.' + str(exp)).
 *
 * @throws if ruleId is not in the catalog.
 */
export function mintUnlockKey(opts: MintUnlockKeyOptions): string {
  if (!isKnownRule(opts.ruleId)) {
    throw new Error(
      `unknown rule_id '${opts.ruleId}' — not in catalog. Run 'unlock-key --list' for valid IDs.`,
    );
  }

  const salt = opts.salt ?? new SaltResolver({ saltPath: opts.saltPath }).resolve();

  if (opts.ttlSec !== undefined && opts.ttlSec > 0) {
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSec;
    const mac = KeyDerivation.derive(salt, `${opts.ruleId}.${exp}`);
    return `ttl.${exp}.${mac}`;
  }

  const mac = KeyDerivation.derive(salt, opts.ruleId);
  return `ll_${mac}`;
}

/** Enumerate catalog-registered rule_ids (excludes gcloud/bq sprintf rules). */
export function listUnlockableRules(): readonly string[] {
  return RULES.map((r) => r.ruleId);
}

function isKnownRule(ruleId: string): boolean {
  return RULES.some((r) => r.ruleId === ruleId);
}
