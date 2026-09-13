import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../../src/cli/run.ts';
import { defaultPolicyPath } from '../../../src/cli/run.ts';
import { UnlockFilter } from '../../../src/unlock/UnlockFilter.ts';

// These tests verify the runCli() pipeline behavior when the unlock filter throws.
// Since we cannot easily inject a faulting filter, we test the contract by:
// 1. Spawning runCli with keys that would normally bypass, but simulating filter errors
//    via a wrapper that monkey-patches UnlockFilter.filter to throw.
// 2. Verifying the decision falls back to deny (engine verdict) with source=unlock-filter-error.

describe('runCli — unlock filter crash fail-mode (LD-G8)', () => {
  let tempDir: string;
  let originalFilter: typeof UnlockFilter.filter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'piopanet-filter-err-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Restore the original filter if it was patched.
    if (originalFilter) {
      UnlockFilter.filter = originalFilter;
    }
    delete process.env.PIOPANET_UNLOCK_KEYS;
  });

  describe('filter crash → falls back to un-filtered engine decision', () => {
    it('when unlock filter throws, decision stays deny with source=unlock-filter-error', async () => {
      // Patch UnlockFilter.filter to throw on every call.
      originalFilter = UnlockFilter.filter;
      UnlockFilter.filter = (() => {
        throw new Error('simulated filter crash');
      }) as any;

      // Set keys so the filter path is exercised.
      process.env.PIOPANET_UNLOCK_KEYS = 'll_a3f9c2b8e1d4abcd';

      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
      });

      // Engine said deny → final decision stays deny.
      expect(result.exitCode).toBe(2);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('deny');
      expect(rec.source).toBe('unlock-filter-error');
    });

    it('NEVER allows by accident of a filter crash', async () => {
      originalFilter = UnlockFilter.filter;
      UnlockFilter.filter = (() => {
        throw new Error('simulated filter crash');
      }) as any;

      process.env.PIOPANET_UNLOCK_KEYS = 'll_a3f9c2b8e1d4abcd';

      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
      });

      // CRITICAL: never allow-by-accident. Even though a valid-looking key is present,
      // the filter crash must NOT grant a bypass.
      expect(result.exitCode).not.toBe(0);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).not.toBe('allow');
    });
  });
});
