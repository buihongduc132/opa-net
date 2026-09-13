import type { ParsedKey } from './types.ts';

/**
 * Parse self-describing key strings [D3].
 *
 * - Long-lived: `ll_<16hex>` → { type:'ll', mac }
 * - TTL:        `ttl.<unix-exp-sec>.<16hex>` → { type:'ttl', exp, mac }
 *
 * Returns null for any malformed input. Hex MUST be lowercase.
 */
export class KeyParser {
  // Static-only utility class — private constructor prevents instantiation.
  private constructor() {}

  private static readonly LL_RE = /^ll_([a-f0-9]{16})$/;
  private static readonly TTL_RE = /^ttl\.(\d+)\.([a-f0-9]{16})$/;

  static parse(raw: string): ParsedKey | null {
    if (typeof raw !== 'string') return null;

    const ll = raw.match(KeyParser.LL_RE);
    if (ll) {
      return { type: 'll', mac: ll[1] };
    }

    const ttl = raw.match(KeyParser.TTL_RE);
    if (ttl) {
      return { type: 'ttl', exp: Number.parseInt(ttl[1], 10), mac: ttl[2] };
    }

    return null;
  }
}
