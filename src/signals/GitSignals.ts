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
 * A token that looks like a commit-ish hash. Git accepts abbreviated object
 * names from 4 hex chars up to a full 40-char SHA-1 (or 64 for SHA-256, but
 * the branch-protection gate only needs to recognize the commit-ish shape).
 */
const COMMIT_ISH_RE = /^[0-9a-fA-F]{4,40}$/;

/**
 * Extract the target branch token from `git checkout/switch <branch>`.
 *
 * Returns the bare token when the form is
 * `<checkout|switch> <single-positional-non-flag>`. Returns null when:
 *   - subcommand is neither checkout nor switch
 *   - ANY flag is present (-b, -, --track, --, -f, ...) — ambiguous intent
 *   - zero or >1 positional args remain
 *   - the single positional token looks like a commit-ish hash
 *
 * COMMIT-ISH DISCRIMINATION (verifier fix):
 * `git checkout <sha>` from a protected branch is a detached-HEAD checkout,
 * NOT a branch switch, so the branch-protection rule MUST NOT fire. Because
 * we cannot reliably distinguish a 4–40 hex-char commit hash from an
 * all-hex branch name at parse time (no git round-trip), we conservatively
 * fail open: a token matching the commit-ish shape returns null. The signal
 * is collected at DECISION time, so current_branch is still the protected
 * branch — treating such a token as a branch would produce a false deny.
 * This only relaxes the gate; non-hex branch names are unaffected.
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
  const token = args[0];
  if (COMMIT_ISH_RE.test(token)) {
    return null;
  }
  return token;
}
