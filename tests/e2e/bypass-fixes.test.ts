import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');

function runPiOpaNet(command: string, cwd = ROOT, env?: Record<string, string>): { exitCode: number; stdout: string; record: any } {
  const fullEnv = { ...process.env, ...env };
  try {
    const stdout = execFileSync('bun', ['run', BIN, 'eval', command, '--json'], {
      encoding: 'utf8',
      timeout: 10000,
      cwd,
      env: fullEnv,
    });
    return { exitCode: 0, stdout, record: JSON.parse(stdout) };
  } catch (err: any) {
    const code = err.status ?? 1;
    const stdout = err.stdout?.toString() ?? '';
    let record: any = null;
    try {
      record = JSON.parse(stdout);
    } catch {
      // not JSON
    }
    return { exitCode: code, stdout, record };
  }
}

describe('Bypass Fixes E2E (V1–V6 + OT)', () => {
  describe('V3: block git branch -m/--move in protected worktrees', () => {
    it('denies git branch -m in protected worktree', () => {
      const res = runPiOpaNet('git branch -m feature-evil');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-branch-move-protected');
    });

    it('denies git branch --move in protected worktree', () => {
      const res = runPiOpaNet('git branch --move feature-evil');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-branch-move-protected');
    });

    it('allows git branch -m when repo is not protected', () => {
      const res = runPiOpaNet('git branch -m feature-evil', ROOT, { PIOPANET_PROTECT_DAYS: '0' });
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });
  });
});
