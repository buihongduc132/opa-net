import { createHmac } from 'node:crypto';

/**
 * Salted HMAC-SHA256 key derivation [D2].
 *
 * `derive(salt, rule_id) = HMAC-SHA256(salt, rule_id).hex().slice(0, 16)`
 *
 * 16 hex = 64-bit mac. Salt defeats rainbow tables (rule_ids are public).
 * HMAC (not bare SHA) so salt stays secret under known-message attack.
 */
export class KeyDerivation {
  // Static-only utility class — private constructor prevents instantiation.
  private constructor() {}

  /**
   * Derive a 16-hex (64-bit) mac from salt + rule_id.
   * @throws if rule_id or salt is empty.
   */
  static derive(salt: Buffer, ruleId: string): string {
    if (!ruleId) {
      throw new Error('rule_id must not be empty');
    }
    if (salt.length === 0) {
      throw new Error('salt must not be empty');
    }
    return createHmac('sha256', salt).update(ruleId).digest('hex').slice(0, 16);
  }
}
