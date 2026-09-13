import type { RawDeny } from '../engine/types.ts';
import type { RuleRegistry } from '../rules/index.ts';
import { KeyParser } from './KeyParser.ts';
import { KeyVerifier } from './KeyVerifier.ts';
import type { UnlockReasonInfo, UnlockResult, VerifyResult } from './types.ts';

/**
 * All-or-nothing unlock filter [D5 / LD-G6].
 *
 * For each deny reason (severity:block), checks if ANY presented key validly
 * unlocks that reason's rule_id. `allow ⟺ every block reason has a valid key`.
 *
 * Expired TTL keys are reported (unlock_status:'expired') but do NOT bypass.
 * `unlock_key_id` is always the first 8 hex of the matching key's mac — the
 * full 16-hex key NEVER appears in the result.
 */
export class UnlockFilter {
  // Static-only utility class — private constructor prevents instantiation.
  private constructor() {}

  /**
   * @param reasons  Raw deny reasons from the engine.
   * @param keys     Raw key strings presented by the agent.
   * @param salt     Deploy-local salt buffer.
   * @param nowMs    Verifier process clock in ms (Date.now()).
   * @param registry Rule registry for message → rule_id lookup.
   */
  static filter(
    reasons: readonly RawDeny[],
    keys: readonly string[],
    salt: Buffer,
    nowMs: number,
    registry: RuleRegistry,
  ): UnlockResult {
    const infos: UnlockReasonInfo[] = reasons.map((deny) => {
      const meta = registry.lookup(deny);
      const ruleId = meta.ruleId;

      let validResult: VerifyResult | null = null;
      let expiredResult: VerifyResult | null = null;
      let validKey: string | null = null;

      for (const key of keys) {
        const result = KeyVerifier.verify(key, ruleId, salt, nowMs);
        if (result.valid) {
          validResult = result;
          validKey = key;
          break;
        }
        if (result.reason === 'expired' && !expiredResult) {
          expiredResult = result;
        }
      }

      if (validResult) {
        const parsed = KeyParser.parse(validKey!);
        const fullMac = parsed?.mac ?? '';
        const keyId = fullMac.slice(0, 8);
        const keyType = validResult.keyType;
        const expiresAt = validResult.expiresAt;
        return {
          message: deny.message,
          ruleId,
          bypassed: true,
          unlockKeyId: keyId,
          keyType,
          expiresAt,
          unlockStatus: 'valid',
          unlock_key_id: keyId,
          unlock_key_type: keyType,
          unlock_expires_at: expiresAt,
          unlock_status: 'valid',
        };
      }

      if (expiredResult) {
        return {
          message: deny.message,
          ruleId,
          bypassed: false,
          unlockKeyId: '',
          unlock_key_id: '',
          unlockStatus: 'expired',
          unlock_status: 'expired',
        };
      }

      return {
        message: deny.message,
        ruleId,
        bypassed: false,
        unlockKeyId: '',
        unlock_key_id: '',
      };
    });

    const bypassedCount = infos.filter((r) => r.bypassed).length;
    const blockedCount = infos.length - bypassedCount;

    return {
      allow: blockedCount === 0,
      bypassedCount,
      blockedCount,
      reasons: infos,
    };
  }
}
