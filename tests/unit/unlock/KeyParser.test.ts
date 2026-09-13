import { describe, expect, it } from 'bun:test';
import { KeyParser } from '../../../src/unlock/KeyParser.ts';

describe('KeyParser', () => {
  describe('parse long-lived keys', () => {
    it('parses ll_<16hex> correctly', () => {
      const result = KeyParser.parse('ll_a3f9c2b8e1d4abcd');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('ll');
      expect(result!.mac).toBe('a3f9c2b8e1d4abcd');
    });

    it('parses ll_ with different hex values', () => {
      const result = KeyParser.parse('ll_0123456789abcdef');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('ll');
      expect(result!.mac).toBe('0123456789abcdef');
    });
  });

  describe('parse TTL keys', () => {
    it('parses ttl.<exp>.<16hex> correctly', () => {
      const result = KeyParser.parse('ttl.1753127056.7c2f8a1b9e0cdddd');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('ttl');
      expect(result!.exp).toBe(1753127056);
      expect(result!.mac).toBe('7c2f8a1b9e0cdddd');
    });

    it('parses TTL with future expiry', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const result = KeyParser.parse(`ttl.${futureExp}.abcdef0123456789`);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('ttl');
      expect(result!.exp).toBe(futureExp);
      expect(result!.mac).toBe('abcdef0123456789');
    });
  });

  describe('reject malformed keys', () => {
    it('rejects empty string', () => {
      expect(KeyParser.parse('')).toBeNull();
    });

    it('rejects unknown prefix', () => {
      expect(KeyParser.parse('foo')).toBeNull();
    });

    it('rejects ll_ with no hex', () => {
      expect(KeyParser.parse('ll_')).toBeNull();
    });

    it('rejects ll_ with non-hex characters', () => {
      expect(KeyParser.parse('ll_xyz')).toBeNull();
    });

    it('rejects ttl with non-numeric expiry', () => {
      expect(KeyParser.parse('ttl.notanumber.abc')).toBeNull();
    });

    it('rejects ll_ with 15 hex (too short)', () => {
      expect(KeyParser.parse('ll_a3f9c2b8e1d4abc')).toBeNull();
    });

    it('rejects ll_ with 17 hex (too long)', () => {
      expect(KeyParser.parse('ll_a3f9c2b8e1d4abcde')).toBeNull();
    });

    it('rejects ttl with 15 hex (too short)', () => {
      expect(KeyParser.parse('ttl.1753127056.7c2f8a1b9e0cddd')).toBeNull();
    });

    it('rejects ttl with 17 hex (too long)', () => {
      expect(KeyParser.parse('ttl.1753127056.7c2f8a1b9e0cddddd')).toBeNull();
    });

    it('rejects uppercase hex', () => {
      expect(KeyParser.parse('ll_A3F9C2B8E1D4ABCD')).toBeNull();
    });

    it('rejects mixed case hex', () => {
      expect(KeyParser.parse('ll_A3f9c2b8e1d4abcd')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('rejects null/undefined (type safety)', () => {
      expect(KeyParser.parse(null as any)).toBeNull();
      expect(KeyParser.parse(undefined as any)).toBeNull();
    });

    it('rejects whitespace-only string', () => {
      expect(KeyParser.parse('   ')).toBeNull();
    });

    it('rejects ll_ with spaces', () => {
      expect(KeyParser.parse('ll_ a3f9c2b8e1d4abcd')).toBeNull();
    });
  });
});
