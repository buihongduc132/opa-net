import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { RawDeny } from '../../../src/engine/types.ts';
// unused: import type { RuleRegistry } from '../../../src/rules/index.ts';
import { RULES } from '../../../src/rules/index.ts';
import { RuleRegistry as RuleRegistryClass } from '../../../src/rules/index.ts';
import { UnlockFilter } from '../../../src/unlock/UnlockFilter.ts';

const salt = Buffer.from('test-salt-32-bytes-exactly-here!!');
const registry = new RuleRegistryClass(RULES);

function deriveKey(ruleId: string, exp?: number): string {
  const input = exp ? `${ruleId}.${exp}` : ruleId;
  const mac = createHmac('sha256', salt).update(input).digest('hex').slice(0, 16);
  return exp ? `ttl.${exp}.${mac}` : `ll_${mac}`;
}

describe('UnlockFilter', () => {
  describe('single rule + valid key → bypassed', () => {
    it('bypasses a single rule when a valid LL key is present', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const key = deriveKey('block-git-stash-mutations');
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.allow).toBe(true);
      expect(result.bypassedCount).toBe(1);
      expect(result.blockedCount).toBe(0);
    });

    it('demotes the bypassed reason and records unlock_key_id', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const key = deriveKey('block-git-stash-mutations');
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.reasons[0].bypassed).toBe(true);
      expect(result.reasons[0].unlock_key_id).toHaveLength(8);
      expect(result.reasons[0].unlock_key_type).toBe('ll');
    });
  });

  describe('single rule + wrong key → blocked', () => {
    it('does not bypass when key is for a different rule', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const key = deriveKey('block-git-reset-hard');
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.allow).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.bypassedCount).toBe(0);
      expect(result.reasons[0].bypassed).toBe(false);
    });
  });

  describe('multi-rule all-unlocked → allow', () => {
    it('allows when ALL reasons have valid keys', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
        { message: "Hard reset discards local work and can remove others' uncommitted changes." },
      ];
      const keys = [deriveKey('block-git-stash-mutations'), deriveKey('block-git-reset-hard')];
      const result = UnlockFilter.filter(reasons, keys, salt, Date.now(), registry);
      expect(result.allow).toBe(true);
      expect(result.bypassedCount).toBe(2);
      expect(result.blockedCount).toBe(0);
    });
  });

  describe('multi-rule partial-unlocked → blocked', () => {
    it('blocks when only 1 of 2 reasons have valid keys', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
        { message: "Hard reset discards local work and can remove others' uncommitted changes." },
      ];
      const keys = [deriveKey('block-git-stash-mutations')];
      const result = UnlockFilter.filter(reasons, keys, salt, Date.now(), registry);
      expect(result.allow).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.bypassedCount).toBe(1);
      expect(result.reasons[0].bypassed).toBe(true);
      expect(result.reasons[1].bypassed).toBe(false);
    });
  });

  describe('empty keys → all blocked', () => {
    it('blocks all reasons when no keys are present', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const result = UnlockFilter.filter(reasons, [], salt, Date.now(), registry);
      expect(result.allow).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.bypassedCount).toBe(0);
      expect(result.reasons[0].bypassed).toBe(false);
    });
  });

  describe('expired TTL key → not bypassed, unlock_status=expired', () => {
    it('records unlock_status=expired and does NOT bypass', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const expiredExp = Math.floor(Date.now() / 1000) - 100;
      const key = deriveKey('block-git-stash-mutations', expiredExp);
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.allow).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.reasons[0].bypassed).toBe(false);
      expect(result.reasons[0].unlock_status).toBe('expired');
    });

    it('valid TTL key bypasses normally', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const validExp = Math.floor(Date.now() / 1000) + 3600;
      const key = deriveKey('block-git-stash-mutations', validExp);
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.allow).toBe(true);
      expect(result.reasons[0].bypassed).toBe(true);
      expect(result.reasons[0].unlock_key_type).toBe('ttl');
      expect(result.reasons[0].unlock_expires_at).toBeDefined();
    });
  });

  describe('unlock_key_id is truncated to 8 hex (never full key)', () => {
    it('unlock_key_id is exactly 8 characters', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const key = deriveKey('block-git-stash-mutations');
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      expect(result.reasons[0].unlock_key_id).toMatch(/^[a-f0-9]{8}$/);
    });

    it('unlock_key_id is a prefix of the full mac, not the full mac', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ];
      const key = deriveKey('block-git-stash-mutations');
      const result = UnlockFilter.filter(reasons, [key], salt, Date.now(), registry);
      const fullMac = key.slice(-16);
      const keyId = result.reasons[0].unlock_key_id;
      expect(fullMac).not.toBe(keyId);
      expect(fullMac.startsWith(keyId)).toBe(true);
    });
  });

  describe('all-or-nothing with mixed TTL + LL keys', () => {
    it('allows when multi-rule has mixed LL + TTL valid keys', () => {
      const reasons: RawDeny[] = [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
        { message: 'git clean can permanently remove untracked files from the working tree.' },
      ];
      const validExp = Math.floor(Date.now() / 1000) + 3600;
      const keys = [
        deriveKey('block-git-stash-mutations'),
        deriveKey('block-git-clean-force', validExp),
      ];
      const result = UnlockFilter.filter(reasons, keys, salt, Date.now(), registry);
      expect(result.allow).toBe(true);
      expect(result.bypassedCount).toBe(2);
    });
  });
});
