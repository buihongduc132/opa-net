import { parse as shellQuoteParse } from 'shell-quote';
import { programBasename } from './unwrapShellDashC.ts';

/**
 * Split a raw command into top-level command segments on shell CONTROL
 * operators (`;`, `;;`, `&&`, `||`, `|`, `|&`, `&`) — while preserving the
 * ORIGINAL raw text of each segment. Token-reconstruction is NOT used because
 * it drops raw `$HOME` (→ empty arg) and glob tokens (`/*`), which are exactly
 * the raw-token deny signals the rego relies on (`rm -rf /*`, `find $HOME`).
 *
 * A quote-aware scanner finds top-level operator positions (operators inside
 * single/double quotes and backslash escapes are NOT boundaries), then the raw
 * string is sliced at those positions so every segment keeps its exact text.
 *
 * `bash -c` / `sh -c` payloads are recursively split: `bash -c 'x' && find /`
 * yields [`x`, `find /`] so a trailing command is evaluated, not dropped.
 */
const TWO_CHAR_OPS = new Set(['&&', '||', '|&', ';;']);

function tryUnwrapDashC(segment: string): string | null {
  let tokens: unknown[];
  try {
    tokens = shellQuoteParse(segment);
  } catch {
    return null;
  }
  const strings = tokens.filter((t): t is string => typeof t === 'string');
  const base = programBasename(strings[0] ?? '');
  if (base !== 'bash' && base !== 'sh') return null;
  for (let i = 0; i < strings.length; i++) {
    const a = strings[i];
    if (a === '-c' || a === '--command') return strings[i + 1] ?? null;
    if (a.startsWith('-') && !a.startsWith('--') && a.includes('c') && a.length <= 4) {
      return strings[i + 1] ?? null;
    }
  }
  return null;
}

/** Split raw on top-level control operators, preserving each segment's raw text. */
function splitRawTopLevel(raw: string): string[] {
  const segments: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === '\\') {
      cur += ch;
      i++;
      if (i < raw.length) {
        cur += raw[i];
        i++;
      }
      continue;
    }

    const two = raw.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      const s = cur.trim();
      if (s) segments.push(s);
      cur = '';
      i += 2;
      continue;
    }
    if (ch === ';') {
      const s = cur.trim();
      if (s) segments.push(s);
      cur = '';
      i++;
      continue;
    }
    if (ch === '|') {
      const s = cur.trim();
      if (s) segments.push(s);
      cur = '';
      i++;
      continue;
    }
    if (ch === '&') {
      // `&` is a control background separator only when NOT part of a redirect
      // (`2>&1`, `>&file`, `&>file`, `&>>file`).
      const next = raw[i + 1];
      if (next !== '>' && next !== '<') {
        const s = cur.trim();
        if (s) segments.push(s);
        cur = '';
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    cur += ch;
    i++;
  }

  const s = cur.trim();
  if (s) segments.push(s);
  return segments.length ? segments : [raw.trim()];
}

export function splitTopLevelSegments(raw: string): string[] {
  const top = splitRawTopLevel(raw);
  const out: string[] = [];
  for (const segment of top) {
    const inner = tryUnwrapDashC(segment);
    if (inner !== null) {
      for (const sub of splitTopLevelSegments(inner)) out.push(sub);
    } else {
      out.push(segment);
    }
  }
  return out.length ? out : [raw.trim()];
}
