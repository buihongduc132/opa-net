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
 * Decision (documented in proposal D3): the parser is branch-name-agnostic
 * for non-hex tokens. BUT for commit-ish tokens (4–40 hex chars) it returns
 * null — a conservative fail-open. We cannot distinguish a commit hash from
 * an all-hex branch name at parse time (no git round-trip), and signals are
 * collected at DECISION time so current_branch is still the protected branch;
 * treating a commit-ish token as a branch would produce a false deny on
 * `git checkout <sha>` from a protected branch. See verifier fix.
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

  it('checkout <commit-ish> → null (conservative fail-open; cannot tell commit from hex branch)', () => {
    // See header comment: a 4–40 hex-char token is ambiguous between a commit
    // hash and an all-hex branch name. Because signals are collected at
    // decision time (current_branch still = the protected branch), treating
    // such a token as a branch would falsely DENY `git checkout <sha>`. We
    // fail open by returning null.
    expect(parseGitTargetBranch('checkout', ['abc1234'])).toBeNull();
  });

  it('checkout <full 40-char SHA> → null (commit-ish)', () => {
    expect(
      parseGitTargetBranch('checkout', ['0123456789abcdef0123456789abcdef01234567']),
    ).toBeNull();
  });

  it('checkout <3-char hex> → bare token (below commit-ish minimum, treated as branch)', () => {
    expect(parseGitTargetBranch('checkout', ['abc'])).toBe('abc');
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
