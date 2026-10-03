import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');

function runPiOpaNet(
  command: string,
  cwd = ROOT,
  env?: Record<string, string>,
): { exitCode: number; stdout: string; record: any } {
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

  describe('V5: treat @ as HEAD in symbolic-ref and update-ref', () => {
    it('denies mutating HEAD via git symbolic-ref @ in protected worktree', () => {
      const res = runPiOpaNet('git symbolic-ref @ refs/heads/feature-evil');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-symbolic-ref-head');
    });

    it('allows read-only git symbolic-ref @ query', () => {
      const res = runPiOpaNet('git symbolic-ref @');
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });

    it('allows read-only git symbolic-ref --short @ query', () => {
      const res = runPiOpaNet('git symbolic-ref --short @');
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });

    it('denies git update-ref @ in protected worktree', () => {
      const res = runPiOpaNet('git update-ref @ 1234567890abcdef1234567890abcdef12345678');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-update-ref-branch');
    });
  });

  describe('V6: block git update-ref --stdin in protected worktrees', () => {
    it('denies git update-ref --stdin in protected worktree', () => {
      const res = runPiOpaNet('git update-ref --stdin');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-update-ref-stdin');
    });

    it('denies piped printf into git update-ref --stdin in protected worktree', () => {
      const res = runPiOpaNet(
        "printf 'update refs/heads/main 1234567890abcdef1234567890abcdef12345678\\n' | git update-ref --stdin",
      );
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-update-ref-stdin');
    });

    it('allows git update-ref --stdin when repo is not protected', () => {
      const res = runPiOpaNet('git update-ref --stdin', ROOT, { PIOPANET_PROTECT_DAYS: '0' });
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });
  });

  describe('OT-6: reflog expire deny & core.logAllRefUpdates tamper guard', () => {
    it('denies git reflog expire in protected worktree', () => {
      const res = runPiOpaNet('git reflog expire --expire=now --all');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-reflog-expire');
    });

    it('denies git reflog delete in protected worktree', () => {
      const res = runPiOpaNet('git reflog delete HEAD@{1}');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-reflog-expire');
    });

    it('allows read-only git reflog in protected worktree', () => {
      const res = runPiOpaNet('git reflog');
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });

    it('denies disabling core.logAllRefUpdates in protected worktree', () => {
      const res = runPiOpaNet('git config core.logAllRefUpdates false');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.reasons[0].rule_id).toBe('block-git-config-logallrefupdates');
    });

    it('allows git reflog expire when repo is not protected', () => {
      const res = runPiOpaNet('git reflog expire --expire=now --all', ROOT, {
        PIOPANET_PROTECT_DAYS: '0',
      });
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });
  });

  describe('V4: track cwd across compound cd / pushd / popd / globals', () => {
    it('denies cd into protected repo && git checkout feature-evil from outside', () => {
      const res = runPiOpaNet(`cd ${ROOT} && git checkout feature-evil`, '/tmp');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.signals?.repo?.protected).toBe(true);
      expect(res.record.reasons[0].message).toContain('branch-target-allowlist');
    });

    it('denies cd to non-existent dir && git checkout (fail-closed)', () => {
      const res = runPiOpaNet('cd /nonexistent/evil/dir && git checkout feature-evil', '/tmp');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.source).toBe('fail-closed');
      expect(res.record.reasons[0].message).toContain('Cannot resolve directory for cd');
    });

    it('tracks pushd and popd cwd changes across segments', () => {
      const res = runPiOpaNet(`pushd ${ROOT} && popd && git checkout feature-evil`, '/tmp');
      expect(res.exitCode).toBe(0);
      expect(res.record.decision).toBe('allow');
    });

    it('propagates --work-tree as effective cwd for signals', () => {
      const res = runPiOpaNet(`git --work-tree=${ROOT} checkout feature-evil`, '/tmp');
      expect(res.exitCode).toBe(2);
      expect(res.record.decision).toBe('deny');
      expect(res.record.signals?.repo?.protected).toBe(true);
    });
  });
});
