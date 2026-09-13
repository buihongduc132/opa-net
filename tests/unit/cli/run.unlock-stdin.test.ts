import { afterEach, describe, expect, it } from 'bun:test';
import { defaultPolicyPath, runCli } from '../../../src/cli/run.ts';

// --unlock-stdin requires a positional command arg (LD-G2).
// We test the CLI flag parsing surface via runCli()'s option shape.

describe('runCli — --unlock-stdin (LD-G2)', () => {
  afterEach(() => {
    delete process.env.PIOPANET_UNLOCK_KEYS;
  });

  describe('--unlock-stdin requires positional command', () => {
    it('rejects --unlock-stdin without a positional command arg', async () => {
      // When unlockStdin is true but no command is provided, runCli must error.
      // We model the option as `unlockStdin: true` + `command: undefined`.
      await expect(
        runCli({
          command: undefined,
          mode: 'json',
          policyPath: defaultPolicyPath(),
          unlockStdin: true,
        } as any),
      ).rejects.toThrow(/positional command/);
    });

    it('rejects --unlock-stdin with empty command string', async () => {
      await expect(
        runCli({
          command: '',
          mode: 'json',
          policyPath: defaultPolicyPath(),
          unlockStdin: true,
        } as any),
      ).rejects.toThrow(/positional command/);
    });
  });

  describe('--unlock-stdin with positional command + key on stdin', () => {
    it('reads the key from stdin when unlockStdin is true and command is positional', async () => {
      // Provide a key via stdin by setting the unlockStdin option.
      // The key must end up in the effective unlock set.
      // We use an obviously-invalid key here; the engine should still deny.
      const result = await runCli({
        command: 'git stash pop',
        mode: 'json',
        policyPath: defaultPolicyPath(),
        unlockStdin: true,
        stdin: 'll_invalidkeyinvalidkey',
      } as any);

      // Even with an invalid key, the pipeline should run without throwing.
      expect(result.exitCode).toBe(2);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('deny');
    });
  });

  describe('command also on stdin without --unlock-stdin → command is read normally', () => {
    it('without unlockStdin, command from positional arg is used', async () => {
      const result = await runCli({
        command: 'git stash list',
        mode: 'claude-code',
        policyPath: defaultPolicyPath(),
      });
      // git stash list is allowed.
      expect(result.exitCode).toBe(0);
    });
  });
});
