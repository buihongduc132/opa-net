/**
 * Signal collector types and context.
 */

import type { ParsedCommand } from '../parser/types.ts';

/** Context passed to every signal collector. */
export interface SignalContext {
  /** The working directory the guarded command would run in. */
  readonly cwd: string;
  /** The raw command string. */
  readonly raw: string;
  /** The parsed command struct. */
  readonly parsed: ParsedCommand;
}

/** Signal collector interface. Returns a record of signal values.
 *  Typed as `object` (not `any`): collectAll only needs an object check
 *  before structural merge; consumers cast to their specific signal shape
 *  (e.g. WorktreeSignal in cli/run.ts). */
export interface SignalCollector {
  /** Collector name (e.g. 'git', 'repo', 'worktree', 'env'). */
  readonly name: string;
  /** Collect signals. Fail-open: return disabled/empty on error. */
  collect(ctx: SignalContext): object;
}

/** Top-level signals object merged into the OPA input. */
export type Signals = Record<string, Readonly<Record<string, unknown>>>;
