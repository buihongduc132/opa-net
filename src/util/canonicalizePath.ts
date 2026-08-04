/**
 * Path canonicalization (LD6) — mandatory security hardening.
 *
 * Runs `fs.realpathSync()` on both the target path AND every allowed-prefix
 * BEFORE Rego sees them. Rejects:
 *   - realpath failure (missing file, broken symlink)
 *   - resolved path containing `..` segments (defense-in-depth; realpath usually resolves these)
 *   - target basename being `.git` (always reject to avoid .git pollution attacks)
 *
 * Boundary enforcement: `startswith(resolved, allowed + path.sep)` so
 * `/opt/worktrees-evil` is NOT matched by `/opt/worktrees`.
 *
 * CVE references: CVE-2026-55607, CVE-2024-32002 (path traversal), OWASP Path Traversal.
 */

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

/** Result of path canonicalization. */
export interface CanonicalizeResult {
  /** True if the path resolves under one of the allowed prefixes. */
  readonly allowed: boolean;
  /** The canonicalized (realpath'd) target path, if resolution succeeded. */
  readonly resolvedTarget?: string;
  /** The canonicalized allowed prefixes (only those that resolved successfully). */
  readonly resolvedPrefixes: readonly string[];
  /** Reason for denial, if any. */
  readonly reason?: string;
}

/** Reject these basenames always (security boundary). */
const FORBIDDEN_BASENAMES = new Set(['.git', '.git']);

/**
 * Canonicalize a target path against a list of allowed prefixes.
 *
 * Returns `{ allowed: boolean, reason?, resolvedTarget?, resolvedPrefixes }`.
 *
 * Path resolution:
 *   1. Try `realpathSync(target)`. If fails → `{ allowed: false, reason: 'realpath-failed' }`.
 *   2. If resolvedTarget has any `..` segments (after splitting on sep) → reject.
 *   3. If basename of resolvedTarget is `.git` → reject.
 *   4. For each allowed prefix, `realpathSync(prefix)`; collect successful ones.
 *   5. For each successful prefix, check `startswith(resolvedTarget, prefix + sep)`
 *      OR exact match (resolvedTarget === prefix). First match → allowed.
 *   6. No match → `{ allowed: false, reason: 'path-outside-allowed' }`.
 */
export function canonicalizePath(
  target: string,
  allowedPrefixes: readonly string[],
): CanonicalizeResult {
  // Step 1: realpath target.
  let resolvedTarget: string;
  try {
    resolvedTarget = realpathSync(target);
  } catch {
    return {
      allowed: false,
      resolvedPrefixes: [],
      reason: 'realpath-failed',
    };
  }

  // Step 2: reject `..` segments (defense-in-depth).
  const segments = resolvedTarget.split(sep);
  if (segments.includes('..')) {
    return {
      allowed: false,
      resolvedTarget,
      resolvedPrefixes: [],
      reason: 'path-traversal',
    };
  }

  // Step 3: reject forbidden basenames.
  const basename = segments[segments.length - 1];
  if (basename && FORBIDDEN_BASENAMES.has(basename)) {
    return {
      allowed: false,
      resolvedTarget,
      resolvedPrefixes: [],
      reason: 'forbidden-basename',
    };
  }

  // Step 4: realpath each allowed prefix.
  const resolvedPrefixes: string[] = [];
  for (const prefix of allowedPrefixes) {
    try {
      const resolved = realpathSync(prefix);
      resolvedPrefixes.push(resolved);
    } catch {
      // Skip prefixes that don't resolve.
    }
  }

  // If no allowed prefixes provided → allow (rule inert by config).
  if (resolvedPrefixes.length === 0) {
    return {
      allowed: true,
      resolvedTarget,
      resolvedPrefixes,
      reason: 'no-allowed-prefixes',
    };
  }

  // Step 5: boundary-enforced prefix match.
  for (const prefix of resolvedPrefixes) {
    if (resolvedTarget === prefix) {
      return { allowed: true, resolvedTarget, resolvedPrefixes };
    }
    if (resolvedTarget.startsWith(prefix + sep)) {
      return { allowed: true, resolvedTarget, resolvedPrefixes };
    }
  }

  // Step 6: no match.
  return {
    allowed: false,
    resolvedTarget,
    resolvedPrefixes,
    reason: 'path-outside-allowed',
  };
}
