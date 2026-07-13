import { execFileSync } from 'node:child_process';
import type { GitSignal, SignalCollector, SignalContext } from './types.ts';

/**
 * GitSignals collector (conditional-branch-gate D3).
 *
 * Shells `git rev-parse --abbrev-ref HEAD` against the decision cwd to learn
 * the current branch, and parses the target branch from `git checkout/switch`.
 *
 * Fail-open contract: on ANY error (non-repo, detached HEAD, missing git,
 * non-zero exit) the collector returns `{ available: false, ... }` instead of
 * throwing. The branch-protection rego rule keys off `available` so a
 * fail-open signal never blocks the decision.
 */
export class GitSignals implements SignalCollector {
  readonly name = 'git';

  collect(ctx: SignalContext): GitSignal {
    const target = parseGitTargetBranch(ctx.parsed.subcommand, ctx.parsed.args);

    // Empty-string gitPath is an explicit "git is missing" simulation — do
    // NOT spawn a subprocess that would ENOENT; return disabled.
    if (ctx.gitPath === '') {
      return { available: false, current_branch: null, target_branch: target };
    }

    const git = ctx.gitPath ?? 'git';
    try {
      const out = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: ctx.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const branch = out.trim();
      if (branch === 'HEAD') {
        // Detached HEAD — available:false so the rule skips.
        return { available: false, current_branch: 'HEAD', target_branch: target };
      }
      return { available: true, current_branch: branch, target_branch: target };
    } catch {
      // Non-repo, ENOENT, or non-zero exit — fail open.
      return { available: false, current_branch: null, target_branch: target };
    }
  }
}

/**
 * Extract the target branch token from `git checkout/switch <branch>`.
 *
 * Branch-name-agnostic (D3): returns the bare token when the form is
 * `<checkout|switch> <single-positional-non-flag>`. Returns null when:
 *   - subcommand is neither checkout nor switch
 *   - ANY flag is present (-b, -, --track, --, -f, ...) — ambiguous intent
 *   - zero or >1 positional args remain
 *
 * The branch-protection rego rule decides whether a non-null token actually
 * constitutes a branch switch; this parser just isolates the candidate.
 */
export function parseGitTargetBranch(subcommand: string, args: string[]): string | null {
  if (subcommand !== 'checkout' && subcommand !== 'switch') {
    return null;
  }
  if (args.some((a) => a.startsWith('-'))) {
    return null;
  }
  if (args.length !== 1) {
    return null;
  }
  return args[0];
}
