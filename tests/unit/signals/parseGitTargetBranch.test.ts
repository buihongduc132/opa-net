import { describe, expect, it } from 'bun:test';
import { parseGitTargetBranch } from '../../../src/signals/GitSignals.ts';

/**
 * Unit tests for parseGitTargetBranch(subcommand, args).
 *
 * Extracts the target branch token from `git checkout <branch>` and
 * `git switch <branch>` while ignoring flags. When the target is ambiguous
 * (flags like -b/-, --track, or no positional arg) it returns null so the
 * branch-protection rule fails open.
 *
 * Decision (documented in proposal D3): the parser is branch-name-agnostic.
 * For `git checkout abc1234` it returns the bare token 'abc1234' — the parser
 * cannot tell a commit from a short branch name. The branch-protection rule
 * in Rego fires only when target_branch is non-null AND differs from
 * current_branch; for a detached-HEAD checkout the practical effect is
 * current_branch becomes null (HEAD detaches), so the rule won't fire.
 * The test asserts parseGitTargetBranch returns the bare token here.
 */

describe('parseGitTargetBranch', () => {
  it('checkout <branch> → branch name', () => {
    expect(parseGitTargetBranch('checkout', ['feature'])).toBe('feature');
  });

  it('switch <branch> → branch name', () => {
    expect(parseGitTargetBranch('switch', ['release-1'])).toBe('release-1');
  });

  it('checkout -b new → null (create flag is ambiguous)', () => {
    expect(parseGitTargetBranch('checkout', ['-b', 'new'])).toBeNull();
  });

  it('checkout - → null (previous-branch shorthand)', () => {
    expect(parseGitTargetBranch('checkout', ['-'])).toBeNull();
  });

  it('checkout <commit-ish> → bare token (rule decides branch-likeness)', () => {
    // See header comment: parser returns the token; Rego decides whether to fire.
    expect(parseGitTargetBranch('checkout', ['abc1234'])).toBe('abc1234');
  });

  it('checkout (no arg) → null', () => {
    expect(parseGitTargetBranch('checkout', [])).toBeNull();
  });

  it('checkout --track origin/x → null (flag, not a branch target)', () => {
    expect(parseGitTargetBranch('checkout', ['--track', 'origin/x'])).toBeNull();
  });

  it('switch (no arg) → null', () => {
    expect(parseGitTargetBranch('switch', [])).toBeNull();
  });

  it('non-switch subcommand → null', () => {
    expect(parseGitTargetBranch('commit', ['-m', 'msg'])).toBeNull();
  });

  it('checkout -f feature (mixed flags + branch) → null (flags present ⇒ ambiguous)', () => {
    expect(parseGitTargetBranch('checkout', ['-f', 'feature'])).toBeNull();
  });

  it('checkout -- feature (path separator only) → null', () => {
    expect(parseGitTargetBranch('checkout', ['--', 'feature'])).toBeNull();
  });
});
