import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parse as shellQuoteParse } from 'shell-quote';
import type { GitConfigEntry, ParsedCommand } from './types.ts';

const MAX_ALIAS_DEPTH = 5;

export interface ResolveGitAliasResult {
  readonly parsed: ParsedCommand;
  readonly isShellAlias?: boolean;
}

/**
 * Resolve git subcommand aliases from:
 * 1. Explicit one-shot -c alias.X=Y arguments
 * 2. Repository .git/config, global, and system configs via /usr/bin/git
 *
 * Safe against recursion (uses /usr/bin/git directly, not shimmed PATH).
 * Bounded depth + cycle detection (G3).
 * Denies shell aliases ('!' prefixed) fail-closed in protected repos (G3).
 */
export function resolveGitAlias(
  parsed: ParsedCommand,
  effectiveCwd: string,
  configs?: readonly GitConfigEntry[],
): ResolveGitAliasResult {
  if (parsed.program !== 'git' || !parsed.subcommand) {
    return { parsed };
  }

  let currentSub = parsed.subcommand;
  let currentArgs = [...parsed.args];
  const visited = new Set<string>();
  let depth = 0;

  while (depth < MAX_ALIAS_DEPTH) {
    if (visited.has(currentSub)) {
      // Cycle detected: stop resolution
      break;
    }
    visited.add(currentSub);

    let aliasValue: string | undefined;

    // 1. One-shot -c configs take precedence (last specified wins)
    if (configs && configs.length > 0) {
      const targetKey = `alias.${currentSub}`.toLowerCase();
      for (let i = configs.length - 1; i >= 0; i--) {
        if (configs[i].key.toLowerCase() === targetKey) {
          aliasValue = configs[i].value;
          break;
        }
      }
    }

    // 2. Query git config from effectiveCwd via /usr/bin/git (G12: bypass shim)
    if (aliasValue === undefined) {
      const gitBin = existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git';
      try {
        const out = execFileSync(
          gitBin,
          ['-C', effectiveCwd, 'config', '--get', `alias.${currentSub}`],
          {
            encoding: 'utf8',
            timeout: 500,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        );
        aliasValue = out.trim();
      } catch {
        // Subcommand is not an alias (or git error)
      }
    }

    if (!aliasValue) {
      // Not an alias — stop resolving
      break;
    }

    // Shell aliases starting with '!'
    if (aliasValue.startsWith('!')) {
      return {
        parsed: {
          ...parsed,
          subcommand: currentSub,
          args: currentArgs,
        },
        isShellAlias: true,
      };
    }

    // Tokenize alias expansion
    let tokens: string[];
    try {
      const rawTokens = shellQuoteParse(aliasValue);
      tokens = rawTokens.filter((t): t is string => typeof t === 'string');
    } catch {
      tokens = aliasValue.split(/\s+/).filter(Boolean);
    }

    if (tokens.length === 0) {
      break;
    }

    currentSub = tokens[0].toLowerCase();
    currentArgs = [...tokens.slice(1), ...currentArgs];
    depth++;
  }

  return {
    parsed: {
      ...parsed,
      subcommand: currentSub,
      args: currentArgs,
    },
  };
}
