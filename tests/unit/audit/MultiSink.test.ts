import { describe, expect, it } from 'bun:test';
import { MultiSink } from '../../../src/audit/MultiSink.ts';
import type { AuditSink } from '../../../src/pi/audit.ts';

/**
 * RED tests for the MultiSink fan-out audit sink (0.4.0 ghost port, scout #1).
 *
 * These tests assert behavior documented in the port plan:
 *   - constructor accepts an array of AuditSink children
 *   - write() calls ALL children sequentially (NOT Promise.all)
 *   - per-child error isolation: if child A throws, child B is still called
 *   - failed children log to stderr with `[pi-opa-net]` prefix
 *   - ordering preserved across children
 */
function makeSink(calls: string[], name: string, opts?: { throwErr?: Error }): AuditSink {
  return {
    write: async (_entry: unknown) => {
      calls.push(name);
      if (opts?.throwErr) throw opts.throwErr;
    },
  };
}

describe('MultiSink', () => {
  it('constructor accepts an array of AuditSink children', () => {
    const a = makeSink([], 'a');
    const b = makeSink([], 'b');
    const sink = new MultiSink([a, b]);
    expect(sink).toBeDefined();
    expect(typeof sink.write).toBe('function');
  });

  it('write(entry) calls ALL children sequentially', async () => {
    const calls: string[] = [];
    const sink = new MultiSink([makeSink(calls, 'a'), makeSink(calls, 'b'), makeSink(calls, 'c')]);
    await sink.write({ decision: 'deny' });
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('if child A throws, child B is still called (per-child error isolation)', async () => {
    const calls: string[] = [];
    const sink = new MultiSink([
      makeSink(calls, 'a', { throwErr: new Error('boom') }),
      makeSink(calls, 'b'),
    ]);
    await sink.write({ decision: 'deny' });
    expect(calls).toEqual(['a', 'b']);
  });

  it('failed child logs to stderr with [pi-opa-net] prefix', async () => {
    const original = console.error;
    const captured: string[] = [];
    console.error = (msg: string) => {
      captured.push(msg);
    };
    try {
      const sink = new MultiSink([makeSink([], 'a', { throwErr: new Error('boom') })]);
      await sink.write({ decision: 'deny' });
      const joined = captured.join('\n');
      expect(joined).toContain('[pi-opa-net]');
      expect(joined).toContain('boom');
    } finally {
      console.error = original;
    }
  });

  it('ordering preserved across children (sequential, not parallel)', async () => {
    const calls: string[] = [];
    // First child is slow — if it were Promise.all, second child might land first.
    const slow: AuditSink = {
      write: async (_e: unknown) => {
        await new Promise((r) => setTimeout(r, 20));
        calls.push('slow');
      },
    };
    const fast: AuditSink = {
      write: async (_e: unknown) => {
        calls.push('fast');
      },
    };
    const sink = new MultiSink([slow, fast]);
    await sink.write({ decision: 'deny' });
    // Sequential: slow must be recorded before fast despite fast being instantaneous.
    expect(calls).toEqual(['slow', 'fast']);
  });
});
