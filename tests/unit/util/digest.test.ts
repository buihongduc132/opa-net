import { describe, expect, it } from 'bun:test';
import { sha256Prefix } from '../../../src/util/digest.ts';

describe('sha256Prefix', () => {
  it('returns 12 hex chars', () => {
    const d = sha256Prefix('nonexistent', () => 'hello world');
    expect(d).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is stable for identical content', () => {
    const a = sha256Prefix('x', () => 'same');
    const b = sha256Prefix('y', () => 'same');
    expect(a).toBe(b);
  });

  it('differs for different content', () => {
    const a = sha256Prefix('x', () => 'aaa');
    const b = sha256Prefix('y', () => 'bbb');
    expect(a).not.toBe(b);
  });

  it('returns zeros on read failure', () => {
    const d = sha256Prefix('x', () => {
      throw new Error('read fail');
    });
    expect(d).toBe('000000000000');
  });
});
