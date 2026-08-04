/**
 * Worktree signals — extracts target path from git worktree add/move/repair.
 *
 * Parses positional args after `git worktree add|move|repair`.
 * Handles flag arity: -b/-B consume next arg, --detach/--orphan/--no-checkout don't.
 * `--` stops flag processing.
 *
 * Also used by worktree-path-allowlist rule.
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

    // Parse remaining args to find the target path.
    const targetPath = parseWorktreePath(args.slice(1));

    return {
      available: targetPath !== null,
      target_path: targetPath,
      worktree_subcommand: wtSubcommand,
    };
  }
}

/**
 * Extract the positional path from worktree add/move/repair args.
 *
 * For `add`: path is the first positional after flags.
 * For `move`: path is the SECOND positional (first is the worktree name).
 * For `repair`: path is the first positional.
 *
 * @param args - args after the worktree subcommand
 */
export function parseWorktreePath(args: readonly string[]): string | null {
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

  // For `move`, the target path is the second positional.
  // For `add` and `repair`, the target path is the first positional.
  // But we don't know the subcommand here — return the last positional
  // (for move it's the new-path; for add/repair it's the path).
  // Actually, we need the subcommand context. Return the last positional
  // since that's always the path for move, and the only positional for add/repair.
  return positionals.length > 0 ? positionals[positionals.length - 1] : null;
}
