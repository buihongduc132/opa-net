/**
 * Strip git global options from args before subcommand classification (LD8).
 *
 * Git accepts global options BEFORE the subcommand (e.g. `git -C /path status`).
 * Without stripping, `rest[0].startsWith('-')` causes ShellQuoteParser to set
 * subcommand="" — defeating all rules. This pre-pass removes known globals so
 * the subcommand classifier sees the real subcommand.
 *
 * Handles both space-separated (`-C /path`) and `=`-joined (`-C=/path`) forms.
 *
 * Returns the stripped args AND any captured -C <path> value (for cwd propagation).
 */

/** Global options that consume the next arg as a value. */
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

/** Global options that take no value (flags only). */
const GLOBAL_OPTIONS_NO_VALUE = new Set([
  '-p',
  '-P',
  '--bare',
  '--paginate',
  '--no-pager',
  '--no-replace-objects',
  '--no-lazy-fetch',
  '--no-optional-locks',
  '--no-advice',
  '--help',
  '--version',
  '--html-path',
  '--man-path',
  '--info-path',
]);

import type { GitConfigEntry } from './types.ts';

/** Result of stripping git global options. */
export interface StripResult {
  /** The args with global options removed. */
  readonly args: string[];
  /** The captured -C <path> value, if present (for cwd propagation). */
  readonly cPath?: string;
  /** The captured --work-tree <path> value, if present. */
  readonly workTree?: string;
  /** The captured --git-dir <path> value, if present. */
  readonly gitDir?: string;
  /** Captured -c and --config-env settings. */
  readonly configs: readonly GitConfigEntry[];
}

/**
 * Strip known git global options from the args array.
 * Returns a new array with globals removed.
 */
export function stripGitGlobalOptions(args: readonly string[]): string[] {
  return stripWithMeta(args).args;
}

/**
 * Strip git global options AND capture -C <path>, --work-tree, --git-dir,
 * and -c / --config-env entries.
 */
export function stripWithMeta(args: readonly string[]): StripResult {
  const result: string[] = [];
  const configs: GitConfigEntry[] = [];
  let cPath: string | undefined;
  let workTree: string | undefined;
  let gitDir: string | undefined;
  let i = 0;

  function parseConfigString(str: string): void {
    const eq = str.indexOf('=');
    if (eq !== -1) {
      configs.push({ key: str.slice(0, eq), value: str.slice(eq + 1) });
    }
  }

  function parseConfigEnvString(str: string): void {
    const eq = str.indexOf('=');
    if (eq !== -1) {
      const key = str.slice(0, eq);
      const envName = str.slice(eq + 1);
      const value = process.env[envName] ?? '';
      configs.push({ key, value });
    }
  }

  while (i < args.length) {
    const arg = args[i];

    // =-joined form: --git-dir=/path, -C=/path, --work-tree=/path, -c=name=val
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (GLOBAL_OPTIONS_WITH_VALUE.has(key)) {
        if (key === '-C') cPath = value;
        else if (key === '--work-tree') workTree = value;
        else if (key === '--git-dir') gitDir = value;
        else if (key === '-c') parseConfigString(value);
        else if (key === '--config-env') parseConfigEnvString(value);
        i++;
        continue;
      }
      if (key.startsWith('-c')) {
        // e.g. -cname=val (first = was after name)
        parseConfigString(arg.slice(2));
        i++;
        continue;
      }
      // Not a global option — the subcommand (or a flag after it) begins here.
      result.push(...args.slice(i));
      break;
    }

    // Space-separated form: -C /path, --work-tree /path, -c name=val
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      const nextVal = i + 1 < args.length ? args[i + 1] : undefined;
      if (nextVal !== undefined) {
        if (arg === '-C') cPath = nextVal;
        else if (arg === '--work-tree') workTree = nextVal;
        else if (arg === '--git-dir') gitDir = nextVal;
        else if (arg === '-c') parseConfigString(nextVal);
        else if (arg === '--config-env') parseConfigEnvString(nextVal);
      }
      i += 2;
      continue;
    }

    // No-value global flags
    if (GLOBAL_OPTIONS_NO_VALUE.has(arg)) {
      i++;
      continue;
    }

    // Attached short options: -C<path>, -c<name>=<value>
    if (arg.startsWith('-C') && arg.length > 2 && !arg.includes('=')) {
      cPath = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-c') && arg.length > 2) {
      parseConfigString(arg.slice(2));
      i++;
      continue;
    }

    // First non-option token = the subcommand; stop stripping.
    result.push(...args.slice(i));
    break;
  }

  return { args: result, cPath, workTree, gitDir, configs };
}
