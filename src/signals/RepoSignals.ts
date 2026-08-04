/**
 * Repo signals — is_main_worktree detection (LD4, D9).
 *
 * Distinguishes parent (main) worktree from linked (sub-)worktrees via
 * `git rev-parse --git-dir` vs `git rev-parse --git-common-dir`.
 *
 *   - Same value → main worktree → branch-target-allowlist fires.
 *   - Different   → linked worktree → rule skips (sub-worktrees roam free).
 *
 * Also collects `signals.repo.name` via `git rev-parse --show-toplevel` → basename.
 * Fail-open on any error.
 */

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import type { SignalCollector, SignalContext } from './types.ts';

export interface RepoSignal {
  readonly available: boolean;
  readonly is_main_worktree: boolean | null;
  readonly name: string | null;
}

export class RepoSignals implements SignalCollector {
  readonly name = 'repo';

  collect(ctx: SignalContext): RepoSignal {
    if (ctx.parsed.program !== 'git') {
      return { available: false, is_main_worktree: null, name: null };
    }

    try {
      const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd: ctx.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 250,
      }).trim();

      let commonDir: string;
      try {
        commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: ctx.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 250,
        }).trim();
      } catch {
        // Fallback: assume main worktree if common-dir can't be resolved.
        commonDir = gitDir;
      }

      // Resolve both to absolute paths for comparison.
      // --git-dir is relative to cwd; --git-common-dir may also be relative.
      const { resolve } = require('node:path') as typeof import('node:path');
      const absGitDir = resolve(ctx.cwd, gitDir);
      const absCommonDir = resolve(ctx.cwd, commonDir);

      const isMain = absGitDir === absCommonDir;

      let name: string | null = null;
      try {
        const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: ctx.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 250,
        }).trim();
        name = basename(toplevel);
      } catch {
        // name stays null.
      }

      return { available: true, is_main_worktree: isMain, name };
    } catch {
      return { available: false, is_main_worktree: null, name: null };
    }
  }
}
