import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Shared test fixture: create a throwaway git repository on a named branch.
 *
 * Used by both unit tests (GitSignals) and e2e tests (branch-protection) so
 * they exercise the real `git` binary the collector will shell out to. Keeps
 * the fixture logic in one place; tests just call `makeTempGitRepo(...)`.
 */
export interface TempRepo {
  /** Absolute path to the repo working directory. */
  readonly dir: string;
  /** Remove the temp repo. Safe to call multiple times. */
  cleanup: () => void;
}

export interface MakeRepoOptions {
  /** Detach HEAD after the initial commit (simulates a detached-HEAD state). */
  detached?: boolean;
}

/**
 * Create a fresh git repo in the OS tmpdir, initialized on `branch`, with one
 * commit so HEAD resolves. Optionally detaches HEAD.
 *
 * Returns { dir, cleanup }. Always call cleanup() in a finally block.
 */
export function makeTempGitRepo(branch: string, opts: MakeRepoOptions = {}): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'pi-opa-git-'));

  git(dir, ['init', '--quiet', `--initial-branch=${branch}`]);
  git(dir, ['config', 'user.email', 'test@pi-opa-net.local']);
  git(dir, ['config', 'user.name', 'pi-opa-net test']);
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'init']);

  if (opts.detached) {
    git(dir, ['checkout', '--quiet', '--detach', 'HEAD']);
  }

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort; temp dir will be reaped by the OS
      }
    },
  };
}

/** Run `git` in `cwd`, throwing on non-zero exit (failures surface in tests). */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Create an empty non-repo temp directory (no .git). For fail-open tests. */
export function makeTempNonRepoDir(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'pi-opa-nogit-'));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}
