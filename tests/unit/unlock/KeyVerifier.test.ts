import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { KeyVerifier } from '../../../src/unlock/KeyVerifier.ts';

describe('KeyVerifier', () => {
  const salt = Buffer.from('test-salt-32-bytes-exactly-here!!');
  const ruleId = 'block-git-stash-mutations';

  function deriveKey(ruleId: string, exp?: number): string {
    const input = exp ? `${ruleId}.${exp}` : ruleId;
    const mac = createHmac('sha256', salt).update(input).digest('hex').slice(0, 16);
    return exp ? `ttl.${exp}.${mac}` : `ll_${mac}`;
  }

  describe('valid long-lived keys', () => {
    it('verifies a valid LL key for the correct rule_id', () => {
      const key = deriveKey(ruleId);
      const result = KeyVerifier.verify(key, ruleId, salt, Date.now());
      expect(result.valid).toBe(true);
      expect(result.keyType).toBe('ll');
    });

    it('returns keyType=ll for LL keys', () => {
      const key = deriveKey(ruleId);
      const result = KeyVerifier.verify(key, ruleId, salt, Date.now());
      expect(result.keyType).toBe('ll');
      expect(result.expiresAt).toBeUndefined();
    });
  });

  describe('valid TTL keys', () => {
    it('verifies a valid TTL key when now < exp', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const key = deriveKey(ruleId, exp);
      const result = KeyVerifier.verify(key, ruleId, salt, Date.now());
      expect(result.valid).toBe(true);
      expect(result.keyType).toBe('ttl');
      expect(result.expiresAt).toBe(exp);
    });

    it('verifies TTL key at exact expiry (now == exp)', () => {
      const exp = Math.floor(Date.now() / 1000);
      const key = deriveKey(ruleId, exp);
      const now = exp * 1000;
      const result = KeyVerifier.verify(key, ruleId, salt, now);
      expect(result.valid).toBe(true);
    });
  });

  describe('expired TTL keys', () => {
    it('rejects TTL key when now > exp', () => {
      const exp = Math.floor(Date.now() / 1000) - 1;
      const key = deriveKey(ruleId, exp);
      const result = KeyVerifier.verify(key, ruleId, salt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('returns unlock_status=expired for expired TTL keys', () => {
      const exp = Math.floor(Date.now() / 1000) - 100;
      const key = deriveKey(ruleId, exp);
      const result = KeyVerifier.verify(key, ruleId, salt, Date.now());
      expect(result.unlockStatus).toBe('expired');
    });
  });

  describe('wrong rule_id', () => {
    it('rejects LL key minted for a different rule_id', () => {
      const key = deriveKey('block-git-stash-mutations');
      const result = KeyVerifier.verify(key, 'block-git-reset-hard', salt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-rule');
    });

    it('rejects TTL key minted for a different rule_id', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const key = deriveKey('block-git-stash-mutations', exp);
      const result = KeyVerifier.verify(key, 'block-git-reset-hard', salt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-rule');
    });
  });

  describe('wrong salt', () => {
    it('rejects LL key minted with a different salt', () => {
      const otherSalt = Buffer.from('other-salt-32-bytes-exactly-here');
      const key = deriveKey(ruleId);
      const result = KeyVerifier.verify(key, ruleId, otherSalt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-salt');
    });

    it('rejects TTL key minted with a different salt', () => {
      const otherSalt = Buffer.from('other-salt-32-bytes-exactly-here');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const key = deriveKey(ruleId, exp);
      const result = KeyVerifier.verify(key, ruleId, otherSalt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('wrong-salt');
    });
  });

  describe('TTL clock strict semantics', () => {
    it('no skew tolerance: TTL key expired by 1ms is rejected', () => {
      const exp = Math.floor(Date.now() / 1000);
      const key = deriveKey(ruleId, exp);
      const now = exp * 1000 + 1;
      const result = KeyVerifier.verify(key, ruleId, salt, now);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });
  });

  describe('malformed keys', () => {
    it('rejects malformed key strings', () => {
      const result = KeyVerifier.verify('invalid-key', ruleId, salt, Date.now());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed');
    });
  });
});
