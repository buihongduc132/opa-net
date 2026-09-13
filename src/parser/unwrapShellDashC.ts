import type { ParsedCommand } from './types.ts';

/**
 * Basename of a program path (`/usr/bin/find` → `find`).
 * Used by bash -c unwrap and by callers that must treat absolute paths
 * as the same program as the bare name.
 */
export function programBasename(program: string): string {
  const idx = program.lastIndexOf('/');
  return (idx >= 0 ? program.slice(idx + 1) : program).toLowerCase();
}

/**
 * Unwrap `bash -c '…'` / `sh -c '…'` so compound evaluation sees the INNER
 * program (OT-bash-c). Quoted `-c` payload is a single arg; the outer `;`
 * splitter must not be the only path that finds `find`/`grep` inside it.
 *
 * Handles `-c`, `--command`, and combined short clusters containing `c`
 * (`-lc`, `-ic`, `-ec`). Returns null when this is not a dash-c invocation
 * or the payload is missing.
 */
export function unwrapShellDashC(parsed: ParsedCommand): string | null {
  const base = programBasename(parsed.program);
  if (base !== 'bash' && base !== 'sh') return null;

  const args = parsed.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '--command') {
      return args[i + 1] ?? null;
    }
    // Short-option cluster with `c` as the final option (`-lc`, `-ic`, `-liec`).
    // Any length is valid — a `<= 4` cap let `bash -liec 'find …'` classify as
    // `bash` and bypass the inner-program gate (cubic P1 on unwrapShellDashC:32).
    if (a.startsWith('-') && !a.startsWith('--') && a.endsWith('c') && /^-[a-zA-Z]*c$/.test(a)) {
      return args[i + 1] ?? null;
    }
  }
  return null;
}
