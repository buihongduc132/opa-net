import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse as shellQuoteParse } from 'shell-quote';

export type CdResult =
  | { readonly type: 'not-cd' }
  | { readonly type: 'success'; readonly newCwd: string; readonly lastCwd: string }
  | { readonly type: 'unresolvable'; readonly target: string; readonly reason: string };

const CD_PROGRAMS = new Set(['cd', 'pushd', 'popd']);

/**
 * Strip leading VAR=val assignments from tokens.
 */
function stripEnvAssignments(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++;
    } else {
      break;
    }
  }
  return tokens.slice(i);
}

/**
 * Resolve target path for cd / pushd.
 */
function resolveTargetPath(
  rawTarget: string | undefined,
  currentCwd: string,
  lastCwd: string,
): string {
  const home = process.env.HOME ?? homedir();
  if (!rawTarget || rawTarget === '~') {
    return home;
  }
  if (rawTarget === '-') {
    return lastCwd || currentCwd;
  }
  if (rawTarget.startsWith('~/')) {
    return resolve(home, rawTarget.slice(2));
  }
  return resolve(currentCwd, rawTarget);
}

/**
 * Detect cd / pushd / popd and compute new working directory.
 */
export function resolveCdChange(
  segment: string,
  currentCwd: string,
  cwdStack: string[],
  lastCwd: string,
): CdResult {
  let rawTokens: unknown[];
  try {
    rawTokens = shellQuoteParse(segment);
  } catch {
    return { type: 'not-cd' };
  }

  const strings = rawTokens.filter((t): t is string => typeof t === 'string');
  const commandTokens = stripEnvAssignments(strings);
  if (commandTokens.length === 0) {
    return { type: 'not-cd' };
  }

  const program = commandTokens[0].toLowerCase();
  if (!CD_PROGRAMS.has(program)) {
    return { type: 'not-cd' };
  }

  if (program === 'popd') {
    if (cwdStack.length > 0) {
      const newCwd = cwdStack.pop()!;
      return { type: 'success', newCwd, lastCwd: currentCwd };
    }
    return { type: 'unresolvable', target: '', reason: 'directory stack empty' };
  }

  // Filter out options like -P, -L, -e, -@
  const args = commandTokens.slice(1).filter((a) => !a.startsWith('-') || a === '-');
  const rawArg = args[0];

  if (program === 'pushd') {
    if (!rawArg) {
      if (cwdStack.length > 0) {
        const top = cwdStack.pop()!;
        cwdStack.push(currentCwd);
        return { type: 'success', newCwd: top, lastCwd: currentCwd };
      }
      return { type: 'unresolvable', target: '', reason: 'directory stack empty' };
    }
    const target = resolveTargetPath(rawArg, currentCwd, lastCwd);
    try {
      if (existsSync(target) && statSync(target).isDirectory()) {
        cwdStack.push(currentCwd);
        return { type: 'success', newCwd: target, lastCwd: currentCwd };
      }
      return {
        type: 'unresolvable',
        target,
        reason: 'directory does not exist or is not a directory',
      };
    } catch {
      return { type: 'unresolvable', target, reason: 'failed to stat directory' };
    }
  }

  // program === 'cd'
  const target = resolveTargetPath(rawArg, currentCwd, lastCwd);
  try {
    if (existsSync(target) && statSync(target).isDirectory()) {
      return { type: 'success', newCwd: target, lastCwd: currentCwd };
    }
    return {
      type: 'unresolvable',
      target,
      reason: 'directory does not exist or is not a directory',
    };
  } catch {
    return { type: 'unresolvable', target, reason: 'failed to stat directory' };
  }
}
