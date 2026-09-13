import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoOpSink } from '../../../src/audit/AuditSink.ts';

describe('NoOpSink', () => {
  describe('onUnlock', () => {
    it('returns void', () => {
      const sink = new NoOpSink();
      const result = sink.onUnlock({
        ruleId: 'block-git-stash-mutations',
        unlockKeyId: 'a3f9c2b8',
        keyType: 'll',
        timestamp: new Date().toISOString(),
      });
      expect(result).toBeUndefined();
    });

    it('does not throw on any input', () => {
      const sink = new NoOpSink();
      expect(() => sink.onUnlock({} as any)).not.toThrow();
      expect(() => sink.onUnlock(null as any)).not.toThrow();
      expect(() => sink.onUnlock(undefined as any)).not.toThrow();
    });
  });

  describe('side-effect freedom', () => {
    it('does NOT write any file to disk', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'noop-sink-'));
      try {
        const beforeFiles = readdirSync(tempDir);
        const sink = new NoOpSink();
        sink.onUnlock({
          ruleId: 'block-git-stash-mutations',
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll',
          timestamp: new Date().toISOString(),
        });
        const afterFiles = readdirSync(tempDir);
        expect(afterFiles).toEqual(beforeFiles);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does NOT make any network call (no fetch/https global mutation)', () => {
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = ((...args: any[]) => {
        fetchCalled = true;
        return Reflect.apply(originalFetch, null, args);
      }) as any;

      try {
        const sink = new NoOpSink();
        sink.onUnlock({
          ruleId: 'block-git-stash-mutations',
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll',
          timestamp: new Date().toISOString(),
        });
        expect(fetchCalled).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
