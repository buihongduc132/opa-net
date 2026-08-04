/**
 * Checkout/switch target disambiguation (LD7).
 *
 * `git checkout` has two distinct semantics:
 *   1. Branch switch:  `git checkout feature`
 *   2. File restore:   `git checkout -- src/app.ts`  OR  `git checkout abc1234 -- file.ts`
 *
 * Without disambiguation, file restore would be misclassified as branch switch.
 *
 * Detection rules (per git-checkout(1) ARGUMENT DISAMBIGUATION):
 *   - If `--` present: pathspec form → file restore, skip branch rules.
 *   - If `--detach`/`-d` present: detached-HEAD intent.
 *   - If first positional is `-`: previous-branch (`@{-1}`).
 *   - Otherwise: classify first positional via `git rev-parse --verify refs/heads/<X>`.
 *     If resolves → branch. If not → commit-ish.
 *   - Normalize `origin/feature` → strip remote prefix for branch lookup.
 */

import { execFileSync } from 'node:child_process';

/** Result of checkout target classification. */
export type CheckoutClassification =
  | { kind: 'branch'; name: string }
  | { kind: 'file-restore' }
  | { kind: 'detached' }
  | { kind: 'commit-ish' }
  | { kind: 'none' };

/** Flags that consume the next arg as a value (checkout/switch). */
const FLAGS_WITH_VALUE = new Set(['--track', '--recurse-submodules', '-l', '--lock', '--source']);

/** Flags that take no value. */
const FLAGS_NO_VALUE = new Set(['-f', '--force', '-m', '--merge', '-p', '--patch', '-q', '--quiet', '--progress', '--no-progress', '-t', '--track', '--no-track', '-2', '--ours', '-3', '--theirs', '--ignore-skip-checks', '--no-guess', '--no-overlay', '--overlay', '--pathspec-file-nul', '--no-write-out-tree', '--write-out-tree']);

/**
 * Classify the target of a `git checkout` / `git switch` command.
 *
 * @param args - args after the subcommand (e.g. ["feature"] or ["--", "file.ts"])
 * @param cwd - the working directory to resolve refs against
 */
export function classifyCheckoutTarget(
  args: readonly string[],
  cwd?: string,
): CheckoutClassification {
  // No args → no target.
  if (args.length === 0) {
    return { kind: 'none' };
  }

  // Detect `--` separator → pathspec form → file restore.
  const dashIdx = args.indexOf('--');
  if (dashIdx !== -1) {
    return { kind: 'file-restore' };
  }

  // Find first positional (skip flags and their values).
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // `-` means previous branch — treat as positional, not a flag.
    if (arg === '-') {
      return { kind: 'detached' };
    }

    // =-joined flag form
    if (arg.startsWith('--') && arg.includes('=')) {
      i++;
      continue;
    }

    if (FLAGS_WITH_VALUE.has(arg)) {
      i += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      i++;
      continue;
    }

    // First positional found.
    return classifyPositional(arg, args, i, cwd);
  }

  // All flags, no positional → check for --detach.
  if (FLAGS_NO_VALUE.has('--detach') || args.some((a) => a === '--detach' || a === '-d')) {
    return { kind: 'detached' };
  }

  return { kind: 'none' };
}

/** Classify a positional token: branch, detached, commit-ish, or file-restore. */
function classifyPositional(
  token: string,
  fullArgs: readonly string[],
  _tokenIdx: number,
  cwd?: string,
): CheckoutClassification {
  // `-` means previous branch.
  if (token === '-') {
    return { kind: 'detached' };
  }

  // Detached HEAD intent.
  if (fullArgs.includes('--detach') || fullArgs.includes('-d')) {
    return { kind: 'detached' };
  }

  // Normalize origin/feature → feature (strip remote prefix for local branch lookup).
  // Only strip if the part after `/` could be a local branch.
  let candidate = token;
  if (token.includes('/')) {
    const parts = token.split('/');
    // Strip leading origin/, upstream/, etc.
    const knownRemotes = ['origin', 'upstream', 'github', 'gerrit'];
    if (knownRemotes.includes(parts[0])) {
      candidate = parts.slice(1).join('/');
    }
  }

  // Resolve via git rev-parse refs/heads/<X>.
  if (cwd && candidate) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 250,
      });
      return { kind: 'branch', name: candidate };
    } catch {
      // Not a local branch ref → commit-ish.
      return { kind: 'commit-ish' };
    }
  }

  // No cwd — assume branch-like (fail-open, let downstream rule decide).
  return { kind: 'branch', name: candidate };
}
