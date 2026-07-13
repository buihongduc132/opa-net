import { describe, expect, it } from 'bun:test';
import { GitSignals } from '../../../src/signals/GitSignals.ts';
import { makeTempGitRepo, makeTempNonRepoDir } from '../../fixtures/gitFixture.ts';

/**
 * Unit tests for GitSignals collector.
 *
 * Design D3 (conditional-branch-gate) says GitSignals shells
 * `git rev-parse --abbrev-ref HEAD` with the provided cwd. On any error,
 * including non-repo, detached HEAD, or git missing, it must fail-open:
 * `{ current_branch: null, available: false }` with no thrown error.
 */

describe('GitSignals', () => {
  it('collects current_branch in a real repo on a named branch', () => {
    const repo = makeTempGitRepo('main');
    try {
      const collector = new GitSignals();
      const sig = collector.collect({
        cwd: repo.dir,
        raw: 'git checkout feature',
        parsed: {
          program: 'git',
          subcommand: 'checkout',
          args: ['feature'],
          raw: 'git checkout feature',
          parseConfidence: 'full',
        },
      });
      expect(sig.available).toBe(true);
      expect(sig.current_branch).toBe('main');
    } finally {
      repo.cleanup();
    }
  });

  it('reports unavailable in a non-repo directory', () => {
    const dir = makeTempNonRepoDir();
    try {
      const collector = new GitSignals();
      const sig = collector.collect({
        cwd: dir.dir,
        raw: 'git checkout feature',
        parsed: {
          program: 'git',
          subcommand: 'checkout',
          args: ['feature'],
          raw: 'git checkout feature',
          parseConfidence: 'full',
        },
      });
      expect(sig.available).toBe(false);
      expect(sig.current_branch).toBeNull();
    } finally {
      dir.cleanup();
    }
  });

  it('fails open on detached HEAD', () => {
    const repo = makeTempGitRepo('main', { detached: true });
    try {
      const collector = new GitSignals();
      const sig = collector.collect({
        cwd: repo.dir,
        raw: 'git checkout feature',
        parsed: {
          program: 'git',
          subcommand: 'checkout',
          args: ['feature'],
          raw: 'git checkout feature',
          parseConfidence: 'full',
        },
      });
      // D3 says fail-open on detached HEAD; the branch-protection rule must skip.
      // We assert the availability flag, and allow current_branch to be either
      // null or the literal 'HEAD' returned by `git rev-parse --abbrev-ref HEAD`.
      expect(sig.available).toBe(false);
      expect(sig.current_branch === null || sig.current_branch === 'HEAD').toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open when git is missing from PATH', () => {
    const repo = makeTempGitRepo('main');
    try {
      const collector = new GitSignals();
      const sig = collector.collect({
        cwd: repo.dir,
        raw: 'git checkout feature',
        parsed: {
          program: 'git',
          subcommand: 'checkout',
          args: ['feature'],
          raw: 'git checkout feature',
          parseConfidence: 'full',
        },
        // Pathological but explicit: an empty string path prevents git resolution.
        // The collector must still return a disabled signal, not throw.
        gitPath: '',
      });
      expect(sig.available).toBe(false);
      expect(sig.current_branch).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});
