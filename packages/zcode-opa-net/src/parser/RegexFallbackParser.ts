import type { CommandParser, ParsedCommand } from './types.ts';

/** Programs with a subcommand shape — mirror of ShellQuoteParser's set. */
const SUBCOMMAND_PROGRAMS = new Set(['git', 'docker', 'gh', 'glab']);

/**
 * Regex-only fallback parser [OT1 resolution: fallback path].
 *
 * Used when the AST parser returns `failed`. Splits on whitespace, lowercases,
 * and applies the same program-aware subcommand classification as ShellQuoteParser.
 * Confidence is always `regex-only` (or `failed` on empty input).
 */
export class RegexFallbackParser implements CommandParser {
  readonly name = 'regex';

  parse(raw: string): ParsedCommand {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { raw, program: '', subcommand: '', args: [], parseConfidence: 'failed' };
    }

    const tokens = trimmed.split(/\s+/);
    const [program, ...rest] = tokens.map((t) => t.toLowerCase());

    if (SUBCOMMAND_PROGRAMS.has(program) && rest.length > 0 && !rest[0].startsWith('-')) {
      const [sub, ...args] = rest;
      return { raw, program, subcommand: sub, args, parseConfidence: 'regex-only' };
    }
    return { raw, program, subcommand: '', args: rest, parseConfidence: 'regex-only' };
  }
}
