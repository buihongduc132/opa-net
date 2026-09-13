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
  '--no-advice',
  '--help',
  '--version',
  '--html-path',
  '--man-path',
  '--info-path',
]);

/** Result of stripping git global options. */
export interface StripResult {
  /** The args with global options removed. */
  readonly args: string[];
  /** The captured -C <path> value, if present (for cwd propagation). */
  readonly cPath?: string;
}

/**
 * Strip known git global options from the args array.
 * Returns a new array with globals removed.
 */
export function stripGitGlobalOptions(args: readonly string[]): string[] {
  return stripWithMeta(args).args;
}

/**
 * Strip git global options AND capture -C <path> for cwd propagation.
 * This is the full version that returns metadata about what was stripped.
 *
 * Globals are stripped ONLY from the leading run before the first
 * subcommand (non-option token). A `-C` AFTER the subcommand is a subcommand
 * flag (e.g. `git switch -C <branch>` = force-create), NOT a global — stripping
 * it here would let the force operation bypass policy (cubic P1 on
 * src/parser/ShellQuoteParser.ts:78).
 */
export function stripWithMeta(args: readonly string[]): StripResult {
  const result: string[] = [];
  let cPath: string | undefined;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // =-joined form: --git-dir=/path, -C=/path
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      if (GLOBAL_OPTIONS_WITH_VALUE.has(key)) {
        if (key === '-C') cPath = value;
        i++;
        continue;
      }
      // Not a global option — the subcommand (or a flag after it) begins here.
      result.push(...args.slice(i));
      break;
    }

    // Space-separated form: -C /path
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      if (arg === '-C' && i + 1 < args.length) {
        cPath = args[i + 1];
      }
      i += 2;
      continue;
    }

    // No-value global flags
    if (GLOBAL_OPTIONS_NO_VALUE.has(arg)) {
      i++;
      continue;
    }

    // First non-option token = the subcommand; stop stripping.
    result.push(...args.slice(i));
    break;
  }

  return { args: result, cPath };
}
