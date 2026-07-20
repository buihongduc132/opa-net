import { afterEach, describe, expect, it } from 'bun:test';
import { defaultPolicyPath, runCli } from '../../../src/cli/run.ts';

describe('runCli — fail-open-keyless degradation (LD-G1)', () => {
  afterEach(() => {
    delete process.env.PIOPANET_UNLOCK_KEYS;
    delete process.env.PI_OPA_BINARY;
  });

  describe('OPA down + keys present → source=fail-open-keyless', () => {
    it('records source=fail-open-keyless (NOT opa-unlocked) when OPA is unreachable and keys are set', async () => {
      // Force OPA to be unreachable by pointing to a non-existent binary.
      process.env.PI_OPA_BINARY = '/nonexistent/opa-binary-that-does-not-exist';
      // Set a key so the unlock path is "active" but cannot filter anything.
      process.env.PIOPANET_UNLOCK_KEYS = 'll_a3f9c2b8e1d4abcd';

      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
      });

      // Fail-open mode (default) → command allowed.
      expect(result.exitCode).toBe(0);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('allow');
      // CRITICAL: source must be fail-open-keyless, NOT opa-unlocked.
      expect(rec.source).toBe('fail-open-keyless');
      expect(rec.source).not.toBe('opa-unlocked');
    });

    it('all reasons have bypassed=false (or absent) under fail-open-keyless', async () => {
      process.env.PI_OPA_BINARY = '/nonexistent/opa-binary-that-does-not-exist';
      process.env.PIOPANET_UNLOCK_KEYS = 'll_a3f9c2b8e1d4abcd';

      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
      });

      const rec = JSON.parse(result.stdout);
      // Under fail-open there are typically no reasons; but if any, bypassed must NOT be true.
      for (const reason of rec.reasons ?? []) {
        expect(reason.bypassed).not.toBe(true);
      }
    });

    it('without keys, plain fail-open behavior (source=fail-open)', async () => {
      process.env.PI_OPA_BINARY = '/nonexistent/opa-binary-that-does-not-exist';
      delete process.env.PIOPANET_UNLOCK_KEYS;

      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
      });

      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('allow');
      // Without keys, source is plain fail-open, NOT fail-open-keyless.
      expect(rec.source).toBe('fail-open');
      expect(rec.source).not.toBe('fail-open-keyless');
    });
  });
});
