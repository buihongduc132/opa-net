import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { listUnlockableRules, mintUnlockKey } from '../../../src/cli/unlock-key.ts';

const salt = Buffer.from('test-salt-32-bytes-exactly-here!!');

function expectedLLKey(ruleId: string): string {
  const mac = createHmac('sha256', salt).update(ruleId).digest('hex').slice(0, 16);
  return `ll_${mac}`;
}

// expectedTTLKey removed — unused in tests (was left over from RED phase).

describe('unlock-key subcommand', () => {
  let tempDir: string;
  let saltPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'piopanet-mint-'));
    saltPath = join(tempDir, 'salt');
    // Write the deterministic test salt so minted keys are reproducible.
    writeFileSync(saltPath, salt, { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('mint long-lived key', () => {
    it('prints ll_<16hex> for a known rule_id', () => {
      const key = mintUnlockKey({
        ruleId: 'block-git-stash-mutations',
        saltPath,
      });
      expect(key).toMatch(/^ll_[a-f0-9]{16}$/);
      expect(key).toBe(expectedLLKey('block-git-stash-mutations'));
    });

    it('produces deterministic output for the same rule + salt', () => {
      const a = mintUnlockKey({ ruleId: 'block-git-stash-mutations', saltPath });
      const b = mintUnlockKey({ ruleId: 'block-git-stash-mutations', saltPath });
      expect(a).toBe(b);
    });
  });

  describe('mint TTL key', () => {
    it('prints ttl.<exp>.<16hex> with exp ≈ now+ttl', () => {
      const before = Math.floor(Date.now() / 1000);
      const key = mintUnlockKey({
        ruleId: 'block-git-stash-mutations',
        saltPath,
        ttlSec: 3600,
      });
      const after = Math.floor(Date.now() / 1000);

      expect(key).toMatch(/^ttl\.\d+\.[a-f0-9]{16}$/);
      const exp = Number.parseInt(key.split('.')[1], 10);
      expect(exp).toBeGreaterThanOrEqual(before + 3600);
      expect(exp).toBeLessThanOrEqual(after + 3600);
    });

    it('TTL key mac matches HMAC(salt, ruleId.exp)', () => {
      const key = mintUnlockKey({
        ruleId: 'block-git-stash-mutations',
        saltPath,
        ttlSec: 3600,
      });
      const parts = key.split('.');
      const exp = Number.parseInt(parts[1], 10);
      const mac = parts[2];
      const expected = createHmac('sha256', salt)
        .update(`block-git-stash-mutations.${exp}`)
        .digest('hex')
        .slice(0, 16);
      expect(mac).toBe(expected);
    });
  });

  describe('--list', () => {
    it('enumerates every catalog rule_id', () => {
      const ruleIds = listUnlockableRules();
      expect(ruleIds).toContain('block-git-stash-mutations');
      expect(ruleIds).toContain('block-git-reset-hard');
      expect(ruleIds).toContain('block-docker-stop');
      expect(ruleIds).toContain('block-tmux-kill-server');
      expect(ruleIds.length).toBeGreaterThan(30);
    });

    it('excludes gcloud/bq (no canonical rule_id) — LD-G4', () => {
      const ruleIds = listUnlockableRules();
      // gcloud/bq produce sprintf messages and have no catalog entry.
      // No rule_id should start with 'gcloud' or 'bq' or be a 'custom:' synthetic.
      for (const id of ruleIds) {
        expect(id.startsWith('gcloud')).toBe(false);
        expect(id.startsWith('bq')).toBe(false);
        expect(id.startsWith('custom:')).toBe(false);
      }
    });
  });

  describe('refuses unknown rule_id', () => {
    it('throws for a rule_id not in the catalog', () => {
      expect(() => mintUnlockKey({ ruleId: 'block-nonexistent-rule', saltPath })).toThrow(
        /unknown rule_id|not in catalog|not found/i,
      );
    });
  });

  describe('CLI binary integration', () => {
    it('`pi-opa-net unlock-key --list` outputs catalog rule_ids', () => {
      const binPath = resolve(__dirname, '../../../bin/pi-opa-net.js');
      const r = spawnSync('bun', [binPath, 'unlock-key', '--list'], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('block-git-stash-mutations');
    });
  });
});
