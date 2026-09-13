/**
 * Worktree signals — extracts target path from git worktree add/move/repair.
 *
 * Parses positional args after `git worktree add|move|repair`.
 * Handles flag arity: -b/-B consume next arg, --detach/--orphan/--no-checkout don't.
 * `--` stops flag processing.
 *
 * Path semantics:
 *   - `git worktree add [<commit-ish>] <path>` → path is LAST positional (commit-ish optional)
 *   - `git worktree move <wt> <new-path>`     → path is LAST positional (new-path)
 *   - `git worktree repair <path>`            → path is FIRST positional
 */

import type { SignalCollector, SignalContext } from './types.ts';

export interface WorktreeSignal {
  readonly available: boolean;
  /** The raw positional path extracted from the command. */
  readonly target_path: string | null;
  /** The worktree subcommand (add, move, repair, list, remove, prune). */
  readonly worktree_subcommand: string | null;
}

/** Flags that consume the next arg as a value (worktree subcommands). */
const WT_FLAGS_WITH_VALUE = new Set(['-b', '-B']);

/** Worktree subcommands that take a path argument. */
const WT_PATH_SUBCOMMANDS = new Set(['add', 'move', 'repair']);

export class WorktreeSignals implements SignalCollector {
  readonly name = 'worktree';

  collect(ctx: SignalContext): WorktreeSignal {
    if (ctx.parsed.program !== 'git' || ctx.parsed.subcommand !== 'worktree') {
      return { available: false, target_path: null, worktree_subcommand: null };
    }

    const args = ctx.parsed.args;
    if (args.length === 0) {
      return { available: false, target_path: null, worktree_subcommand: null };
    }

    // First positional is the worktree subcommand.
    const wtSubcommand = args[0];
    if (!WT_PATH_SUBCOMMANDS.has(wtSubcommand)) {
      return { available: false, target_path: null, worktree_subcommand: wtSubcommand };
    }

    // Parse remaining args to find positionals.
    const positionals = parsePositionals(args.slice(1));

    if (positionals.length === 0) {
      return { available: false, target_path: null, worktree_subcommand: wtSubcommand };
    }

    // Path extraction depends on subcommand:
    //   - add:   modern git synopsis is `<path> [<commit-ish>]` (path FIRST),
    //            but old-style `git worktree add <commit-ish> <path>` also
    //            works — when 2 positionals exist, pick the path-LIKE one;
    //            falls back to first positional (modern form).
    //   - move:  <wt> <new-path> → path is LAST positional (new-path).
    //   - repair: <path> [<backup>] → path is FIRST positional.
    // FIX: previous implementation always took the LAST positional, which
    // misread `git worktree add .worktrees/foo HEAD` as targeting path "HEAD"
    // and wrongly denied a legitimate allowlisted worktree add.
    let targetPath: string;
    if (wtSubcommand === 'add' && positionals.length >= 2) {
      const first = positionals[0];
      const last = positionals[positionals.length - 1];
      // Priority: explicit ref tokens (refs/, origin/, HEAD*, sha) → path is
      // the other positional. Else path-LIKE disambiguation, else first
      // (modern path-first synopsis).
      if (isRefLike(first)) targetPath = last;
      else if (isRefLike(last)) targetPath = first;
      else targetPath = isPathLike(last) && !isPathLike(first) ? last : first;
    } else if (wtSubcommand === 'move') {
      targetPath = positionals[positionals.length - 1];
    } else {
      targetPath = positionals[0];
    }

    return {
      available: targetPath !== null,
      target_path: targetPath,
      worktree_subcommand: wtSubcommand,
    };
  }
}

/** Heuristic: does a token look like a filesystem path rather than a ref?
 *  Path-like: starts with ./ ../ / ~ . or contains a '/'. Refs like HEAD,
 *  main, v1.2.3 are not path-like. */
function isPathLike(token: string): boolean {
  return token.includes('/') || /^[.~]/.test(token);
}

/** Explicit ref detection (higher confidence than isPathLike inverse):
 *  refs/…, origin/… (remote-tracking), HEAD / HEAD~n / HEAD^, bare git sha. */
function isRefLike(token: string): boolean {
  return (
    token.startsWith('refs/') ||
    token.startsWith('origin/') ||
    /^HEAD([~^]\d*)*$/.test(token) ||
    /^[0-9a-f]{7,40}$/.test(token)
  );
}

/**
 * Parse positional args, skipping flags and their values.
 * Handles `--` separator.
 *
 * @param args - args after the worktree subcommand
 * @returns array of positional tokens (non-flag, non-value)
 */
export function parsePositionals(args: readonly string[]): string[] {
  const positionals: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // `--` stops flag processing.
    if (arg === '--') {
      // Everything after `--` is positional.
      for (let j = i + 1; j < args.length; j++) {
        positionals.push(args[j]);
      }
      break;
    }

    // =-joined form: -b<val>
    if (arg.startsWith('-') && arg.includes('=')) {
      i++;
      continue;
    }

    if (WT_FLAGS_WITH_VALUE.has(arg)) {
      i += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      i++;
      continue;
    }

    positionals.push(arg);
    i++;
  }

  return positionals;
}

/**
 * @deprecated Use parsePositionals instead. Kept for backwards compat.
 * Returns the last positional (which is the path for add/move/repair).
 */
export function parseWorktreePath(args: readonly string[]): string | null {
  const positionals = parsePositionals(args);
  return positionals.length > 0 ? positionals[positionals.length - 1] : null;
}
