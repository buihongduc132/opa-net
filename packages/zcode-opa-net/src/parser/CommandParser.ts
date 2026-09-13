import { RegexFallbackParser } from './RegexFallbackParser.ts';
import { ShellQuoteParser } from './ShellQuoteParser.ts';
import type { CommandParser, ParsedCommand } from './types.ts';

/**
 * Hybrid parser coordinator [OT1 resolution].
 *
 * Strategy: AST primary (ShellQuoteParser), regex fallback when AST reports
 * `failed`. `partial` and `regex-only` results are returned as-is — the
 * `parseConfidence` field surfaces which path fired per-decision.
 */
export class CommandParserCoordinator implements CommandParser {
  readonly name = 'hybrid';
  private readonly primary: CommandParser;
  private readonly fallback: CommandParser;

  constructor(
    primary: CommandParser = new ShellQuoteParser(),
    fallback: CommandParser = new RegexFallbackParser(),
  ) {
    this.primary = primary;
    this.fallback = fallback;
  }

  parse(raw: string): ParsedCommand {
    const result = this.primary.parse(raw);
    if (result.parseConfidence === 'failed') {
      return this.fallback.parse(raw);
    }
    return result;
  }
}
