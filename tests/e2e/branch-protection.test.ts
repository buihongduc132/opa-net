import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { git, makeTempGitRepo, makeTempNonRepoDir } from '../fixtures/gitFixture.ts';

/**
 * E2E for the conditional-branch-gate feature: full pipeline
 * CLI → parser → GitSignals → OPA rego → DecisionBuilder → output.
 *
 * Each scenario spawns the real `pi-opa-net` binary with the cwd set to a
 * throwaway git repo, so the GitSignals collector observes that repo's
 * current branch. These tests are RED until the impl lands (signals +
 * branch-protection rule + config). That is the expected failing state.
 */

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');

// OPA is required for these e2e. Detect via PATH (the CLI resolves its own
// binary path internally). If absent, the tests still register but will fail —
// which is acceptable for RED; we surface the blocker in the report.
const OPA_AVAILABLE = (() => {
  try {
    execFileSync('command', ['-v', 'opa'], { encoding: 'utf8', shell: '/bin/sh' });
    return true;
  } catch {
    try {
      execFileSync('opa', ['version'], { encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }
})();

interface CliRun {
  exitCode: number;
  stdout: string;
  record?: Record<string, unknown>;
}

function runInRepo(command: string, cwd: string, envExtra: Record<string, string> = {}): CliRun {
  const args = ['run', BIN, 'eval', command, '--json'];
  try {
    const stdout = execFileSync('bun', args, {
      encoding: 'utf8',
      cwd,
      timeout: 15000,
      env: { ...process.env, ...envExtra },
    });
    return { exitCode: 0, stdout, record: tryParse(stdout) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      record: tryParse(e.stdout ?? ''),
    };
  }
}

function tryParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function branchProtectionReasons(rec: Record<string, unknown>): unknown[] {
  const reasons = (rec.reasons as Array<Record<string, unknown>>) ?? [];
  return reasons.filter(
    (r) => typeof r.message === 'string' && /branch-protection/.test(r.message as string),
  );
}

describe.skipIf(!OPA_AVAILABLE)('branch-protection e2e (live CLI + OPA)', () => {
  it('checkout away from main → DENY, reason cites branch-protection', () => {
    const repo = makeTempGitRepo('main');
    git(repo.dir, ['branch', 'feature']); // create a REAL local branch
    try {
      const r = runInRepo('git checkout feature', repo.dir);
      expect(r.exitCode).toBe(2);
      const rec = r.record!;
      expect(rec.decision).toBe('deny');
      expect(branchProtectionReasons(rec).length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });

  it('switch away from staging → DENY', () => {
    const repo = makeTempGitRepo('staging');
    git(repo.dir, ['branch', 'release-1']); // create a REAL local branch
    try {
      const r = runInRepo('git switch release-1', repo.dir);
      expect(r.exitCode).toBe(2);
      const rec = r.record!;
      expect(rec.decision).toBe('deny');
      expect(branchProtectionReasons(rec).length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });

  it('checkout from non-protected branch (feature) → ALLOW', () => {
    const repo = makeTempGitRepo('feature');
    git(repo.dir, ['branch', 'main']); // make target a REAL local branch
    try {
      const r = runInRepo('git checkout main', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('checkout to the SAME protected branch (main→main) → ALLOW', () => {
    const repo = makeTempGitRepo('main');
    try {
      const r = runInRepo('git checkout main', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('checkout a full SHA from main → ALLOW (not a branch switch)', () => {
    const repo = makeTempGitRepo('main');
    try {
      const sha = git(repo.dir, ['rev-parse', 'HEAD']).trim();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const r = runInRepo(`git checkout ${sha}`, repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('checkout with no arg → ALLOW', () => {
    const repo = makeTempGitRepo('main');
    try {
      const r = runInRepo('git checkout', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('detached HEAD → ALLOW (rule skips)', () => {
    const repo = makeTempGitRepo('main', { detached: true });
    try {
      const r = runInRepo('git checkout feature', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('non-repo cwd → ALLOW (rule skips)', () => {
    const dir = makeTempNonRepoDir();
    try {
      const r = runInRepo('git checkout feature', dir.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      dir.cleanup();
    }
  });

  it('PIOPANET_PROTECTED_BRANCHES="" → rule disabled → ALLOW', () => {
    const repo = makeTempGitRepo('main');
    try {
      const r = runInRepo('git checkout feature', repo.dir, {
        PIOPANET_PROTECTED_BRANCHES: '',
      });
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('PIOPANET_PROTECTED_BRANCHES="trunk,develop": trunk DENY, main ALLOW', () => {
    const trunk = makeTempGitRepo('trunk');
    git(trunk.dir, ['branch', 'feature']); // REAL target branch
    const main = makeTempGitRepo('main');
    git(main.dir, ['branch', 'feature']); // REAL target branch
    try {
      const denyR = runInRepo('git checkout feature', trunk.dir, {
        PIOPANET_PROTECTED_BRANCHES: 'trunk,develop',
      });
      expect(denyR.exitCode).toBe(2);
      expect(denyR.record!.decision).toBe('deny');
      expect(branchProtectionReasons(denyR.record!).length).toBeGreaterThan(0);

      const allowR = runInRepo('git checkout feature', main.dir, {
        PIOPANET_PROTECTED_BRANCHES: 'trunk,develop',
      });
      expect(allowR.exitCode).toBe(0);
      expect(allowR.record!.decision).toBe('allow');
      expect(branchProtectionReasons(allowR.record!).length).toBe(0);
    } finally {
      trunk.cleanup();
      main.cleanup();
    }
  });

  it('non-git command has no signals.git in the decision record', () => {
    const repo = makeTempGitRepo('main');
    try {
      // `ls -la` is a clearly-allowed, non-git command. (The task suggested
      // `docker stop foo`, but that is DENY'd by the pre-existing GROUP B
      // docker rule — unrelated to branch-protection. Using `ls -la` isolates
      // the signal-absence assertion this scenario is really about.)
      const r = runInRepo('ls -la', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      // signals.git MUST be absent OR available:false for non-git commands.
      const signals = (rec.signals as Record<string, unknown> | undefined) ?? undefined;
      const git = signals?.git as Record<string, unknown> | undefined;
      expect(signals === undefined || git === undefined || git.available === false).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('deny decision record CONTAINS signals.git.current_branch + target_branch (provenance)', () => {
    const repo = makeTempGitRepo('main');
    git(repo.dir, ['branch', 'feature']); // create a REAL local branch
    try {
      const r = runInRepo('git checkout feature', repo.dir);
      expect(r.exitCode).toBe(2);
      const rec = r.record!;
      const signals = rec.signals as Record<string, unknown> | undefined;
      expect(signals, `signals missing on record: ${r.stdout}`).toBeDefined();
      const git = (signals!.git as Record<string, unknown>) ?? undefined;
      expect(git, `signals.git missing: ${r.stdout}`).toBeDefined();
      expect(git!.current_branch).toBe('main');
      expect(git!.target_branch).toBe('feature');
    } finally {
      repo.cleanup();
    }
  });

  it('checkout a tracked FILE (README.md) from main → ALLOW (not a branch switch)', () => {
    const repo = makeTempGitRepo('main');
    try {
      // `git checkout <file>` restores a tracked file from the index — it is
      // NOT a branch switch. The branch-protection rule MUST NOT fire even
      // though `README.md` parses as a valid target token.
      const r = runInRepo('git checkout README.md', repo.dir);
      expect(r.exitCode).toBe(0);
      const rec = r.record!;
      expect(rec.decision).toBe('allow');
      expect(branchProtectionReasons(rec).length).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('checkout a REAL local branch created via `git branch` → DENY', () => {
    const repo = makeTempGitRepo('main');
    git(repo.dir, ['branch', 'feature']); // create a real second branch
    try {
      const r = runInRepo('git checkout feature', repo.dir);
      expect(r.exitCode).toBe(2);
      const rec = r.record!;
      expect(rec.decision).toBe('deny');
      expect(branchProtectionReasons(rec).length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });
});
