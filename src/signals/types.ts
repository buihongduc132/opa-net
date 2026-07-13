/**
 * Context signals — structured environment facts collected at decision time
 * (conditional-branch-gate design D2/D5).
 *
 * Signals augment the parsed command with facts OPA itself cannot observe
 * (e.g. the current git branch). Each SignalCollector is keyed by `.name`
 * in the merged Signals object and surfaced on the decision record under
 * `signals.<name>`.
 */

/**
 * Minimal view of a parsed command. Structurally compatible with
 * `ParsedCommand` (parser/types.ts) — accepted by collectors without
 * pulling the parser into the signals module.
 */
export interface ParsedCommandLike {
  program: string;
  subcommand: string;
  args: string[];
  raw: string;
  parseConfidence: string;
}

/** Context handed to every collector at decision time. */
export interface SignalContext {
  /** Working directory the command will run in. */
  cwd: string;
  /** Original command string. */
  raw: string;
  /** Normalized command view. */
  parsed: ParsedCommandLike;
  /** Optional override for the git binary path. `''` simulates missing git. */
  gitPath?: string;
}

/** Git-specific signal payload. */
export interface GitSignal {
  available: boolean;
  current_branch: string | null;
  target_branch?: string | null;
  /** Index signature so GitSignal satisfies SignalCollector's return type. */
  [key: string]: unknown;
}

/** Merged signals keyed by collector.name (e.g. `signals.git`). */
export type Signals = Record<string, Record<string, unknown>>;

/** A signal collector — gathers one named signal from the context. */
export interface SignalCollector {
  /** Stable key under which the collector's output is merged. */
  name: string;
  /** Collect the signal. Should NEVER throw — fail-open via { available: false }. */
  collect(ctx: SignalContext): Record<string, unknown>;
}
