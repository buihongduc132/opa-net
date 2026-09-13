/**
 * Normalized command structure — the "decide half" input to OPA.
 * Matches the `EvaluatedInput` schema (minus `raw` which is added at output).
 */
export interface ParsedCommand {
  /** Original command string verbatim. */
  readonly raw: string;
  /** Normalized program name (lowercase). Empty string if unparseable. */
  readonly program: string;
  /** Normalized subcommand. Empty string if none (bare-default case [OT3]). */
  readonly subcommand: string;
  /** Normalized arg tokens. Empty array if none. */
  readonly args: readonly string[];
  /** Parser fidelity — surfaces how well the command was parsed [OT1]. */
  readonly parseConfidence: ParseConfidence;
  /** Captured -C <path> from git global options (LD8). Used for cwd propagation to signal collection. */
  readonly gitCwd?: string;
}

export type ParseConfidence = 'full' | 'partial' | 'regex-only' | 'failed';

/**
 * Strategy interface for command parsing [OT1 resolution: hybrid].
 * Implementations: ShellQuoteParser (AST primary), RegexFallbackParser (fallback).
 */
export interface CommandParser {
  readonly name: string;
  parse(raw: string): ParsedCommand;
}
