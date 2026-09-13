/**
 * Shared types for the unlock subsystem [D1-D11].
 *
 * These types are the contract between UnlockFilter → DecisionBuilder.
 * Internal (TS-side) property naming uses camelCase; the DecisionBuilder
 * translates to snake_case schema fields at output time.
 */

/** Result of parsing a raw key string. */
export interface ParsedKey {
  readonly type: 'll' | 'ttl';
  readonly mac: string;
  /** Unix expiry in seconds. Present only for TTL keys. */
  readonly exp?: number;
}

/** Outcome of verifying a parsed key against a rule_id + salt. */
export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?: 'malformed' | 'wrong-rule' | 'wrong-salt' | 'expired';
  readonly keyType?: 'll' | 'ttl';
  /** Unix expiry in seconds (TTL only). */
  readonly expiresAt?: number;
  readonly unlockStatus?: 'valid' | 'expired';
}

/**
 * Per-reason unlock info produced by UnlockFilter.
 *
 * Carries BOTH camelCase (consumed by DecisionBuilder) and snake_case
 * (consumed by UnlockFilter test assertions) aliases so the same object
 * satisfies both consumers without conversion.
 */
export interface UnlockReasonInfo {
  readonly message: string;
  readonly ruleId: string;
  readonly bypassed: boolean;

  /** camelCase aliases — DecisionBuilder reads these. */
  readonly unlockKeyId: string;
  readonly keyType?: 'll' | 'ttl';
  readonly expiresAt?: number;
  readonly unlockStatus?: 'valid' | 'expired';

  /** snake_case aliases — schema-compatible / UnlockFilter assertions. */
  readonly unlock_key_id: string;
  readonly unlock_key_type?: 'll' | 'ttl';
  readonly unlock_expires_at?: number;
  readonly unlock_status?: 'valid' | 'expired';
}

/** Aggregate result of filtering reasons through unlock keys. */
export interface UnlockResult {
  readonly allow: boolean;
  readonly bypassedCount: number;
  readonly blockedCount: number;
  readonly reasons: readonly UnlockReasonInfo[];
}
