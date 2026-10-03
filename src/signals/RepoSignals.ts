/**
 * Repo signals — is_main_worktree and protected detection (LD4, D9, F2, R2).
 *
 * Distinguishes parent (main) worktree from linked (sub-)worktrees and young
 * worktrees:
 *   - Git-native: `git rev-parse --git-dir` vs `git rev-parse --git-common-dir`.
 *     Different → linked worktree.
 *   - Standalone sibling clones: among siblings sharing repo name prefix
 *     (with separator `-`, `_`, `.`), shortest basename = main.
 *   - Young worktrees (R2): worktree age < PIOPANET_PROTECT_DAYS (default 3)
 *     is protected (same as main). Age is read from the first entry of the
 *     worktree's own HEAD reflog (`logs/HEAD`), fallback dir mtime.
 *   - Single policy input: `signals.repo.protected` = is_main_worktree || age < protect_days.
 *
 * Fail-open on any error.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { SignalCollector, SignalContext } from './types.ts';

import { DEFAULT_PROTECT_DAYS } from '../config/Config.ts';

export interface RepoSignal {
  readonly available: boolean;
  readonly is_main_worktree: boolean | null;
  readonly protected: boolean | null;
  readonly age_days: number | null;
  readonly name: string | null;
}

export interface RepoSignalsOptions {
  /** Injectable clock returning unix timestamp in ms for deterministic tests. */
  readonly now?: () => number;
  /** Worktree protection boundary in days. Default: 3. */
  readonly protectDays?: number;
}

export class RepoSignals implements SignalCollector {
  readonly name = 'repo';
  private readonly options?: RepoSignalsOptions;

  constructor(options?: RepoSignalsOptions) {
    this.options = options;
  }

  collect(ctx: SignalContext): RepoSignal {
    if (ctx.parsed.program !== 'git') {
      return {
        available: false,
        is_main_worktree: null,
        protected: null,
        age_days: null,
        name: null,
      };
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
      const absGitDir = resolve(ctx.cwd, gitDir);
      const absCommonDir = resolve(ctx.cwd, commonDir);

      const gitNativeIsMain = absGitDir === absCommonDir;

      let name: string | null = null;
      let toplevel: string | null = null;
      try {
        toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: ctx.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 250,
        }).trim();
        name = basename(toplevel);
      } catch {
        // name stays null.
      }

      // Main-dir rule (F2):
      // - Linked worktree -> git-native (absGitDir !== absCommonDir means linked worktree, NOT main).
      // - Standalone clone -> among sibling dirs with same repo-name prefix (same parent), SHORTEST basename = main.
      let isMain = gitNativeIsMain;

      if (gitNativeIsMain && toplevel && name) {
        try {
          const parentDir = dirname(toplevel);
          let remoteRepoName: string | null = null;
          try {
            const remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
              cwd: ctx.cwd,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 250,
            }).trim();
            if (remoteUrl) {
              const match =
                remoteUrl.match(/\/([^/]+?)(?:\.git)?$/) || remoteUrl.match(/:([^/]+?)(?:\.git)?$/);
              if (match) remoteRepoName = match[1];
            }
          } catch {
            // no remote
          }

          const entries = readdirSync(parentDir, { withFileTypes: true });
          const siblings = entries
            .filter((e) => e.isDirectory() || e.isSymbolicLink())
            .map((e) => e.name);

          const family = siblings
            .filter((s) => {
              if (s === name) return true;
              if (s.startsWith(`${name}-`) || s.startsWith(`${name}_`) || s.startsWith(`${name}.`))
                return true;
              if (name.startsWith(`${s}-`) || name.startsWith(`${s}_`) || name.startsWith(`${s}.`))
                return true;
              if (remoteRepoName) {
                if (
                  s === remoteRepoName ||
                  s.startsWith(`${remoteRepoName}-`) ||
                  s.startsWith(`${remoteRepoName}_`) ||
                  s.startsWith(`${remoteRepoName}.`)
                ) {
                  return true;
                }
              }
              return false;
            })
            .filter((s) => {
              return existsSync(resolve(parentDir, s, '.git'));
            });

          if (family.length > 0) {
            family.sort((a, b) => a.length - b.length || a.localeCompare(b));
            isMain = name === family[0];
          }
        } catch {
          isMain = gitNativeIsMain;
        }
      }

      // Age calculation (R2):
      // Age = FIRST entry of .git/worktrees/<id>/logs/HEAD (unix ts field), fallback dir mtime.
      // Sibling-clone lanes: check logs/HEAD, fallback dir mtime.
      const nowMs = this.options?.now ? this.options.now() : Date.now();
      let createdMs: number | null = null;

      if (!isMain) {
        // Non-main worktree or sibling clone: check logs/HEAD inside absGitDir
        const logsHead = resolve(absGitDir, 'logs/HEAD');
        if (existsSync(logsHead)) {
          try {
            const content = readFileSync(logsHead, 'utf8');
            const lines = content.split('\n').filter((l: string) => l.trim().length > 0);
            if (lines.length > 0) {
              const firstLine = lines[0];
              // Format: <old> <new> <name> <<email>> <unix-ts> <tz>...
              const match = firstLine.match(/>\s+(\d{9,12})\s+[-+]?\d{4}/);
              if (match) {
                const tsSec = Number.parseInt(match[1], 10);
                if (!Number.isNaN(tsSec) && tsSec > 0) {
                  createdMs = tsSec * 1000;
                }
              }
            }
          } catch {
            // fallback below
          }
        }
      }

      // Fallback if not determined from logs/HEAD:
      if (createdMs === null) {
        try {
          const targetDir = toplevel ?? ctx.cwd;
          const stat = statSync(targetDir);
          createdMs = stat.mtimeMs;
        } catch {
          createdMs = null;
        }
      }

      let ageDays: number | null = null;
      if (createdMs !== null) {
        ageDays = Number(((nowMs - createdMs) / (1000 * 86400)).toFixed(2));
        if (ageDays < 0) ageDays = 0;
      }

      // Knob PIOPANET_PROTECT_DAYS (OT-7 centralized spelling, default 3).
      const protectDays =
        this.options?.protectDays ??
        (process.env.PIOPANET_PROTECT_DAYS
          ? Number.parseFloat(process.env.PIOPANET_PROTECT_DAYS)
          : DEFAULT_PROTECT_DAYS);

      // Single policy input: signals.repo.protected (bool) = is_main_worktree || age < protect_days.
      const isProtected = isMain || (ageDays !== null && ageDays < protectDays);

      return {
        available: true,
        is_main_worktree: isMain,
        protected: isProtected,
        age_days: ageDays,
        name,
      };
    } catch {
      return {
        available: false,
        is_main_worktree: null,
        protected: null,
        age_days: null,
        name: null,
      };
    }
  }
}
