import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { KeyDerivation } from '../../../src/unlock/KeyDerivation.ts';

describe('KeyDerivation', () => {
  const salt = Buffer.from('test-salt-32-bytes-exactly-here!!');

  describe('deterministic derivation', () => {
    it('returns the same 16-hex string for the same salt + rule_id', () => {
      const a = KeyDerivation.derive(salt, 'block-git-stash-mutations');
      const b = KeyDerivation.derive(salt, 'block-git-stash-mutations');
      expect(a).toBe(b);
    });

    it('matches a hand-computed HMAC-SHA256 prefix', () => {
      const expected = createHmac('sha256', salt)
        .update('block-git-stash-mutations')
        .digest('hex')
        .slice(0, 16);
      expect(KeyDerivation.derive(salt, 'block-git-stash-mutations')).toBe(expected);
    });
  });

  describe('salt sensitivity', () => {
    it('produces different keys for different salts (same rule_id)', () => {
      const saltA = Buffer.from('salt-A-salt-A-salt-A-salt-A-salt');
      const saltB = Buffer.from('salt-B-salt-B-salt-B-salt-B-salt');
      const a = KeyDerivation.derive(saltA, 'block-git-stash-mutations');
      const b = KeyDerivation.derive(saltB, 'block-git-stash-mutations');
      expect(a).not.toBe(b);
    });
  });

  describe('output length', () => {
    it('returns exactly 16 lowercase hex characters', () => {
      const out = KeyDerivation.derive(salt, 'block-git-stash-mutations');
      expect(out).toMatch(/^[a-f0-9]{16}$/);
      expect(out.length).toBe(16);
    });

    it('returns 16 hex for every catalog rule_id', () => {
      const ruleIds = [
        'block-git-commit-am',
        'block-git-stash-mutations',
        'block-docker-stop',
        'block-rm-bd-sub-skills',
        'block-gh-repo-delete-archive',
        'block-tmux-kill-server',
      ];
      for (const ruleId of ruleIds) {
        const out = KeyDerivation.derive(salt, ruleId);
        expect(out).toMatch(/^[a-f0-9]{16}$/);
      }
    });
  });

  describe('input validation', () => {
    it('rejects empty rule_id', () => {
      expect(() => KeyDerivation.derive(salt, '')).toThrow();
    });

    it('rejects empty salt', () => {
      expect(() => KeyDerivation.derive(Buffer.alloc(0), 'block-git-stash-mutations')).toThrow();
    });
  });
});
