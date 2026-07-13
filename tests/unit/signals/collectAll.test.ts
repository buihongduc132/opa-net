import { describe, expect, it } from 'bun:test';
import { collectAll } from '../../../src/signals/collectAll.ts';
import type { SignalCollector } from '../../../src/signals/types.ts';

/**
 * Unit tests for collectAll(collectors, context).
 *
 * Design D2: runs an array of SignalCollectors and merges their outputs into a
 * single Signals object. Any collector that throws is suppressed — its signal
 * becomes { available: false } and the others still merge.
 */

const CTX = {
  cwd: '/tmp/fake',
  raw: 'git checkout feature',
  parsed: {
    program: 'git',
    subcommand: 'checkout',
    args: ['feature'],
    raw: 'git checkout feature',
    parseConfidence: 'full',
  },
};

describe('collectAll', () => {
  it('merges outputs from multiple collectors', () => {
    const a: SignalCollector = {
      name: 'a',
      collect: () => ({ available: true, current_branch: 'main', target_branch: null }),
    };
    const b: SignalCollector = {
      name: 'b',
      collect: () => ({ available: true, env_cwd: '/tmp/fake' }),
    };
    const merged = collectAll([a, b], CTX);
    expect(merged).toBeDefined();
    // Each collector's keyed signal should be present.
    expect((merged as Record<string, unknown>).a).toBeDefined();
    expect((merged as Record<string, unknown>).b).toBeDefined();
  });

  it('suppresses a thrown error from one collector (others still merged)', () => {
    const good: SignalCollector = {
      name: 'good',
      collect: () => ({ available: true, current_branch: 'main' }),
    };
    const bad: SignalCollector = {
      name: 'bad',
      collect: () => {
        throw new Error('boom');
      },
    };
    const merged = collectAll([good, bad], CTX) as Record<string, Record<string, unknown>>;
    // good still merged
    expect(merged.good.available).toBe(true);
    // bad suppressed → available:false, no throw propagated
    expect(merged.bad.available).toBe(false);
  });

  it('empty collectors array → empty signals object', () => {
    const merged = collectAll([], CTX);
    expect(merged).toEqual({});
  });
});
