import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

/**
 * E2E test for the full unlock flow:
 * 1. Mint a key via `pi-opa-net unlock-key <rule_id>`
 * 2. Set PIOPANET_UNLOCK_KEYS env
 * 3. Run `pi-opa-net eval "git stash pop"` → source:opa-unlocked, exit 0
 * 4. Without key → deny, exit 2
 * 5. Expired TTL → still deny with unlock_status:expired
 */
describe('e2e — unlock flow', () => {
  let tempDir: string;
  let saltPath: string;
  const binPath = resolve(__dirname, '../../bin/pi-opa-net.js');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'piopanet-e2e-'));
    saltPath = join(tempDir, 'salt');
    // Pre-generate a salt file with known content.
    const saltContent = Buffer.from('e2e-test-salt-32-bytes-exactly!!!');
    writeFileSync(saltPath, saltContent, { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function runBin(
    args: string[],
    env: Record<string, string> = {},
  ): { stdout: string; stderr: string; exitCode: number } {
    const r = spawnSync('bun', [binPath, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, ...env },
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? 1 };
  }

  function deriveKey(ruleId: string, exp?: number): string {
    const salt = Buffer.from('e2e-test-salt-32-bytes-exactly!!!');
    const input = exp ? `${ruleId}.${exp}` : ruleId;
    const mac = createHmac('sha256', salt).update(input).digest('hex').slice(0, 16);
    return exp ? `ttl.${exp}.${mac}` : `ll_${mac}`;
  }

  describe('mint + use long-lived key', () => {
    it('minted key allows the blocked command', () => {
      // Step 1: Mint a key.
      const mintResult = runBin(['unlock-key', 'block-git-stash-mutations'], {
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(mintResult.exitCode).toBe(0);
      const key = mintResult.stdout.trim();
      expect(key).toMatch(/^ll_[a-f0-9]{16}$/);

      // Step 2: Use the key to allow a blocked command.
      const evalResult = runBin(['eval', '--json', 'git stash pop'], {
        PIOPANET_UNLOCK_KEYS: key,
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(evalResult.exitCode).toBe(0);
      const rec = JSON.parse(evalResult.stdout);
      expect(rec.decision).toBe('allow');
      expect(rec.source).toBe('opa-unlocked');
    });
  });

  describe('without key → deny', () => {
    it('blocked command stays blocked without a key', () => {
      const result = runBin(['eval', '--json', 'git stash pop'], {
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(result.exitCode).toBe(2);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('deny');
      expect(rec.source).toBe('opa');
    });
  });

  describe('expired TTL → still deny with unlock_status=expired', () => {
    it('expired TTL key does not bypass the rule', () => {
      // Mint a TTL key that expired 100 seconds ago.
      const expiredExp = Math.floor(Date.now() / 1000) - 100;
      const key = deriveKey('block-git-stash-mutations', expiredExp);

      const result = runBin(['eval', '--json', 'git stash pop'], {
        PIOPANET_UNLOCK_KEYS: key,
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(result.exitCode).toBe(2);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('deny');
      // The reason should show unlock_status=expired.
      const reason = rec.reasons[0];
      expect(reason.unlock_status).toBe('expired');
    });
  });

  describe('valid TTL key → allow', () => {
    it('valid TTL key bypasses the rule', () => {
      const validExp = Math.floor(Date.now() / 1000) + 3600;
      const key = deriveKey('block-git-stash-mutations', validExp);

      const result = runBin(['eval', '--json', 'git stash pop'], {
        PIOPANET_UNLOCK_KEYS: key,
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(result.exitCode).toBe(0);
      const rec = JSON.parse(result.stdout);
      expect(rec.decision).toBe('allow');
      expect(rec.source).toBe('opa-unlocked');
    });
  });

  describe('unlock-key --list', () => {
    it('enumerates catalog rule_ids', () => {
      const result = runBin(['unlock-key', '--list'], {
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('block-git-stash-mutations');
      expect(result.stdout).toContain('block-git-reset-hard');
    });
  });

  describe('unlock-key refuses unknown rule', () => {
    it('exits non-zero for an unknown rule_id', () => {
      const result = runBin(['unlock-key', 'block-nonexistent-rule'], {
        PIOPANET_UNLOCK_SALT: saltPath,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/unknown rule_id|not in catalog|not found/i);
    });
  });
});
