import { afterAll, describe, expect, it } from 'bun:test';
import { classifyCheckoutTarget } from '../../../src/parser/checkoutTarget.ts';

describe('classifyCheckoutTarget', () => {
  describe('file restore (pathspec form)', () => {
    it('detects -- separator → file-restore', () => {
      expect(classifyCheckoutTarget(['--', 'src/app.ts'])).toEqual({ kind: 'file-restore' });
    });

    it('detects -- with no files → file-restore', () => {
      expect(classifyCheckoutTarget(['--'])).toEqual({ kind: 'file-restore' });
    });

    it('detects branch -- file.ts → file-restore', () => {
      expect(classifyCheckoutTarget(['feature', '--', 'src/app.ts'])).toEqual({
        kind: 'file-restore',
      });
    });
  });

  describe('detached HEAD', () => {
    it('detects --detach flag', () => {
      expect(classifyCheckoutTarget(['--detach', 'abc1234'])).toEqual({ kind: 'detached' });
    });

    it('detects -d flag', () => {
      expect(classifyCheckoutTarget(['-d', 'abc1234'])).toEqual({ kind: 'detached' });
    });

    it('detects - (previous branch) as detached', () => {
      expect(classifyCheckoutTarget(['-'])).toEqual({ kind: 'detached' });
    });
  });

  describe('branch classification (no cwd → assume branch)', () => {
    it('bare branch name → branch', () => {
      expect(classifyCheckoutTarget(['feature'])).toEqual({ kind: 'branch', name: 'feature' });
    });

    it('strips origin/ prefix → branch with stripped name', () => {
      expect(classifyCheckoutTarget(['origin/feature'])).toEqual({
        kind: 'branch',
        name: 'feature',
      });
    });

    it('strips upstream/ prefix', () => {
      expect(classifyCheckoutTarget(['upstream/develop'])).toEqual({
        kind: 'branch',
        name: 'develop',
      });
    });
  });

  describe('edge cases', () => {
    it('empty args → none', () => {
      expect(classifyCheckoutTarget([])).toEqual({ kind: 'none' });
    });

    it('flags only with --detach → detached', () => {
      expect(classifyCheckoutTarget(['--detach'])).toEqual({ kind: 'detached' });
    });

    it('flags only without --detach → none', () => {
      expect(classifyCheckoutTarget(['-f'])).toEqual({ kind: 'none' });
    });

    it('strips -b flag before positional', () => {
      expect(classifyCheckoutTarget(['-b', 'new-branch'])).toEqual({
        kind: 'branch',
        name: 'new-branch',
      });
    });
  });

  describe('E3, E4, E5, E6 with real git repo cwd', () => {
    const { mkdtempSync, rmSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const { join } = require('node:path') as typeof import('node:path');
    const { execSync } = require('node:child_process') as typeof import('node:child_process');

    // Create a real git fixture
    const repoDir = mkdtempSync(join(tmpdir(), 'checkout-target-test-'));
    execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name test', { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(join(repoDir, 'init.txt'), 'hello');
    execSync(
      'git -c core.hooksPath=/dev/null add init.txt && git -c core.hooksPath=/dev/null commit --no-verify -m init',
      { cwd: repoDir, stdio: 'ignore' },
    );
    const initialCommitSha = execSync('git rev-parse HEAD', {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    execSync('git branch local-feat', { cwd: repoDir, stdio: 'ignore' });

    it('E3: checkout -b <new> → kind branch (even when <new> does not exist yet)', () => {
      const res = classifyCheckoutTarget(['-b', 'brand-new-branch'], repoDir);
      expect(res).toEqual({ kind: 'branch', name: 'brand-new-branch' });
    });

    it('E4: checkout origin/<x> (no local branch) → kind branch name <x>', () => {
      const res = classifyCheckoutTarget(['origin/remote-only-branch'], repoDir);
      expect(res).toEqual({ kind: 'branch', name: 'remote-only-branch' });
    });

    it('E5: checkout <sha> / --detach → kind detached', () => {
      const resSha = classifyCheckoutTarget([initialCommitSha], repoDir);
      expect(resSha).toEqual({ kind: 'detached' });

      const resShortSha = classifyCheckoutTarget([initialCommitSha.slice(0, 7)], repoDir);
      expect(resShortSha).toEqual({ kind: 'detached' });

      const resDetach = classifyCheckoutTarget(['--detach', 'local-feat'], repoDir);
      expect(resDetach).toEqual({ kind: 'detached' });
    });

    it('E6: switch -c <new> → kind branch (even when <new> does not exist yet)', () => {
      const res = classifyCheckoutTarget(['-c', 'brand-new-switch-branch'], repoDir);
      expect(res).toEqual({ kind: 'branch', name: 'brand-new-switch-branch' });

      const resCapC = classifyCheckoutTarget(['-C', 'force-created-branch'], repoDir);
      expect(resCapC).toEqual({ kind: 'branch', name: 'force-created-branch' });
    });

    afterAll(() => {
      if (repoDir) {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });
  });
});
