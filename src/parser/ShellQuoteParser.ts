import { parse as shellQuoteParse } from 'shell-quote';
import type { CommandParser, ParsedCommand } from './types.ts';
import { stripWithMeta } from './stripGitGlobalOptions.ts';

/**
 * Programs that use a `[program, subcommand, args...]` shape.
 * For programs NOT in this set (rm, bd, gcloud, bq, ls, ...), every token
 * after the program is an arg and subcommand is "". This matches how the
 * rego policy queries each family (git/docker/gh/glab check subcommand;
 * rm/bd/gcloud/bq check args).
 */
const SUBCOMMAND_PROGRAMS = new Set(['git', 'docker', 'gh', 'glab']);

/**
 * AST-based parser using shell-quote [OT1 resolution: primary path].
 *
 * Produces `parseConfidence: full` when shell-quote tokenizes cleanly into
 * a simple [program, subcommand?, args...] shape. Falls back to `partial`
 * when redirects/pipelines/subshells are detected (structured tokens still
 * extracted but the command is flagged as not a plain invocation).
 */
export class ShellQuoteParser implements CommandParser {
  readonly name = 'shell-quote';

  parse(raw: string): ParsedCommand {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return emptyParsed(raw, 'failed');
    }

    let tokens: unknown[];
    try {
      tokens = shellQuoteParse(trimmed);
    } catch {
      // shell-quote throws on unbalanced quotes etc. — defer to regex fallback.
      return emptyParsed(raw, 'failed');
    }

    const hasMeta = tokens.some(isMetaToken);
    const strings = tokens.filter((t): t is string => typeof t === 'string');

    if (strings.length === 0) {
      return emptyParsed(raw, hasMeta ? 'partial' : 'failed');
    }

    return classify(strings, raw, hasMeta);
  }
}

/** Apply program-aware subcommand classification. */
function classify(strings: string[], raw: string, hasMeta: boolean): ParsedCommand {
  const [programRaw, ...rest] = strings;
  const program = programRaw.toLowerCase();
  const confidence = hasMeta ? 'partial' : 'full';

  // LD8: Strip git global options BEFORE subcommand classification.
  // Without this, `git -C /evil worktree add foo` → subcommand="" (all rules defeated).
  // Also capture -C <path> for cwd propagation to signal collection.
  let effectiveRest = rest;
  let gitCwd: string | undefined;
  if (program === 'git') {
    const stripped = stripWithMeta(rest);
    effectiveRest = stripped.args;
    gitCwd = stripped.cPath;
  }

  // Subcommand-style programs: tokens[1] is the subcommand (unless it's a flag).
  if (SUBCOMMAND_PROGRAMS.has(program) && effectiveRest.length > 0 && !effectiveRest[0].startsWith('-')) {
    const [sub, ...args] = effectiveRest;
    return { raw, program, subcommand: sub.toLowerCase(), args, parseConfidence: confidence, gitCwd };
  }

  // Non-subcommand programs: everything after program is an arg.
  return { raw, program, subcommand: '', args: effectiveRest, parseConfidence: confidence, gitCwd };
}

/** shell-quote emits objects ({op, ...}) for redirects/pipelines/subshells. */
function isMetaToken(token: unknown): boolean {
  return typeof token === 'object' && token !== null;
}

function emptyParsed(raw: string, confidence: ParsedCommand['parseConfidence']): ParsedCommand {
  return { raw, program: '', subcommand: '', args: [], parseConfidence: confidence };
}
