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

    // Path extraction depends on subcommand:
    //   - add:   [<commit-ish>] <path> → path is LAST positional
    //   - move:  <wt> <new-path>       → path is LAST positional (new-path)
    //   - repair: <path>               → path is LAST positional (first/only)
    // For all three, the path is the LAST positional (semantically consistent).
    // For add: if commit-ish given, it's the first positional; path is second.
    //         If only path given, it's the only positional.
    // For move: first positional is the worktree name, second is new-path.
    // For repair: only positional(s) are paths.
    const targetPath = positionals.length > 0 ? positionals[positionals.length - 1] : null;

    return {
      available: targetPath !== null,
      target_path: targetPath,
      worktree_subcommand: wtSubcommand,
    };
  }
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
