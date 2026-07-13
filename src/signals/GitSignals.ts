import { execFileSync } from 'node:child_process';
import type { GitSignal, SignalCollector, SignalContext } from './types.ts';

/**
 * GitSignals collector (conditional-branch-gate D3).
 *
 * Shells `git rev-parse --abbrev-ref HEAD` against the decision cwd to learn
 * the current branch, parses the target branch from `git checkout/switch`,
 * and verifies the parsed target token resolves as an ACTUAL local branch
 * (`git rev-parse --verify --quiet refs/heads/<target>`). File-path tokens
 * (e.g. `git checkout README.md`) and tag tokens fail this check and are
 * treated as NOT-a-branch, so the rule only fires for real branch switches.
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
    let available = false;
    let currentBranch: string | null = null;
    try {
      const out = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: ctx.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Bound the call so a hung credential helper or stuck hook cannot
        // block the eval indefinitely; the catch below preserves fail-open.
        timeout: 5000,
      });
      const branch = out.trim();
      if (branch === 'HEAD') {
        // Detached HEAD — available:false so the rule skips.
        return { available: false, current_branch: 'HEAD', target_branch: target };
      }
      available = true;
      currentBranch = branch;
    } catch {
      // Non-repo, ENOENT, or non-zero exit — fail open.
      return { available: false, current_branch: null, target_branch: target };
    }

    // Verify the parsed target token resolves as an ACTUAL local branch
    // (`refs/heads/<target>`). This is the authoritative check that covers
    // file-path tokens (e.g. `git checkout README.md`), tag tokens, and
    // branch-shaped-but-not-existing tokens. Any error or non-zero exit ⇒
    // treat as NOT-a-branch ⇒ set target_branch=null (fail-open).
    let verifiedTarget = target;
    if (available && target !== null) {
      try {
        execFileSync(git, ['rev-parse', '--verify', '--quiet', `refs/heads/${target}`], {
          cwd: ctx.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        });
        // exit 0 ⇒ is a local branch; keep verifiedTarget === target.
      } catch {
        // Non-zero exit / error ⇒ not a local branch ⇒ skip the rule.
        verifiedTarget = null;
      }
    }

    return { available, current_branch: currentBranch, target_branch: verifiedTarget };
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
