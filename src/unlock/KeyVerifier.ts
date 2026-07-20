import { RULES } from '../rules/index.ts';
import { KeyDerivation } from './KeyDerivation.ts';
import { KeyParser } from './KeyParser.ts';
import type { VerifyResult } from './types.ts';

/**
 * Verify a raw key string against a rule_id + salt [D2][D3].
 *
 * LL: valid iff `derive(salt, rule_id) === parsed.mac`.
 * TTL: valid iff `derive(salt, rule_id + '.' + str(exp)) === parsed.mac`
 *      AND `now/1000 <= exp` (strict, no skew tolerance).
 *
 * When the mac does not match, wrong-rule vs wrong-salt is disambiguated by
 * re-deriving against every catalog rule_id with the given salt. If any
 * known rule matches → wrong-rule; otherwise → wrong-salt.
 */
export class KeyVerifier {
  // Static-only utility class — private constructor prevents instantiation.
  private constructor() {}

  /**
   * @param rawKey   Key string (ll_… or ttl.…) from the agent.
   * @param ruleId   The rule_id to check against.
   * @param salt     Deploy-local salt buffer.
   * @param nowMs    Verifier process clock in milliseconds (Date.now()).
   */
  static verify(rawKey: string, ruleId: string, salt: Buffer, nowMs: number): VerifyResult {
    const parsed = KeyParser.parse(rawKey);
    if (!parsed) {
      return { valid: false, reason: 'malformed' };
    }

    const input =
      parsed.type === 'ttl' && parsed.exp !== undefined ? `${ruleId}.${parsed.exp}` : ruleId;
    const derived = KeyDerivation.derive(salt, input);

    if (derived === parsed.mac) {
      // Mac matches — check TTL clock.
      if (parsed.type === 'ttl' && parsed.exp !== undefined) {
        const nowSec = nowMs / 1000;
        if (nowSec > parsed.exp) {
          return {
            valid: false,
            reason: 'expired',
            keyType: 'ttl',
            expiresAt: parsed.exp,
            unlockStatus: 'expired',
          };
        }
        return {
          valid: true,
          keyType: 'ttl',
          expiresAt: parsed.exp,
          unlockStatus: 'valid',
        };
      }
      return { valid: true, keyType: 'll', unlockStatus: 'valid' };
    }

    // Mac mismatch — try every catalog rule with the given salt.
    for (const rule of RULES) {
      const tryInput =
        parsed.type === 'ttl' && parsed.exp !== undefined
          ? `${rule.ruleId}.${parsed.exp}`
          : rule.ruleId;
      const tryMac = KeyDerivation.derive(salt, tryInput);
      if (tryMac === parsed.mac) {
        return { valid: false, reason: 'wrong-rule', keyType: parsed.type };
      }
    }

    return { valid: false, reason: 'wrong-salt', keyType: parsed.type };
  }
}
