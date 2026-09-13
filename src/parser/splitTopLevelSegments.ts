import { parse as shellQuoteParse } from 'shell-quote';
import { programBasename } from './unwrapShellDashC.ts';

/**
 * Split a raw command into top-level command segments on shell CONTROL
 * operators (`;`, `;;`, `&&`, `||`, `|`, `|&`, `&`) — while respecting
 * quoting, which a naive string split cannot (`bash -c 'echo; find'` must not
 * be cut at the inner `;`).
 *
 * Redirects (`>`, `>>`, `<`, …) are NOT segment boundaries; their surrounding
 * words stay in the same segment (safety evaluation keys on the program, not
 * the redirect target).
 *
 * `bash -c` / `sh -c` payloads are recursively split: `bash -c 'x' && find /`
 * yields [`x`, `find /`] so the trailing command is evaluated instead of
 * silently dropped (cubic P0 on src/cli/run.ts:145).
 */
const CONTROL_OPS = new Set([';', ';;', '&&', '||', '|', '|&', '&']);

function isDashCProgram(tokens: string[]): boolean {
  const p = programBasename(tokens[0] ?? '');
  return p === 'bash' || p === 'sh';
}

function dashCIndex(args: string[]): number {
  return args.findIndex(
    (a) =>
      a === '-c' ||
      a === '--command' ||
      (a.startsWith('-') && !a.startsWith('--') && a.includes('c') && a.length <= 4),
  );
}

export function splitTopLevelSegments(raw: string): string[] {
  const trimmed = raw.trim();
  let tokens: unknown[];
  try {
    tokens = shellQuoteParse(trimmed);
  } catch {
    return [trimmed];
  }

  const strings = tokens.filter((t): t is string => typeof t === 'string');
  if (strings.length === 0) return [trimmed];

  // bash -c / sh -c: the -c payload is a full command string; split it too and
  // keep any trailing words (separated by dropped control ops) as a tail segment.
  if (isDashCProgram(strings)) {
    const i = dashCIndex(strings);
    if (i >= 0 && strings[i + 1]) {
      const payload = strings[i + 1];
      const tail = strings.slice(i + 2);
      const segs: string[] = [];
      for (const s of splitTopLevelSegments(payload)) segs.push(s);
      const tailSeg = tail.join(' ').trim();
      if (tailSeg) segs.push(tailSeg);
      return segs;
    }
  }

  const segments: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    const s = cur.join(' ').trim();
    if (s) segments.push(s);
    cur = [];
  };
  for (const t of tokens) {
    if (typeof t === 'object' && t !== null) {
      const op = (t as { op?: string }).op ?? '';
      if (CONTROL_OPS.has(op)) flush();
      // Non-control ops (redirects): the object is not a word; surrounding
      // string tokens stay in `cur`.
    } else if (typeof t === 'string') {
      cur.push(t);
    }
  }
  flush();
  return segments.length ? segments : [trimmed];
}
