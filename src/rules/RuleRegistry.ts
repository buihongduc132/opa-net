import type { RawDeny } from '../engine/types.ts';

export type RuleFamily =
  | 'git'
  | 'docker'
  | 'rm'
  | 'gcloud'
  | 'bq'
  | 'gh'
  | 'glab'
  | 'bd'
  | 'builtin'
  | 'custom'
  | 'tmux'
  | 'pkill'
  | 'killall';

export interface RuleMeta {
  readonly ruleId: string;
  readonly family: RuleFamily;
  readonly message: string;
  /** Safe alternatives for the "did you mean?" UX. Optional. */
  readonly suggestions?: readonly string[];
  /**
   * Disambiguation tokens used ONLY when multiple registered rules share an
   * identical message AND family (collision). If any of these tokens appears
   * in the parsed command's args, this candidate wins. Only needed for rules
   * whose reason text is byte-identical to a sibling rule's (e.g.
   * block-tmux-kill-server vs block-tmux-kill-session, which share the same
   * verbatim reason and family 'tmux').
   */
  readonly matchArgs?: readonly string[];
}

/**
 * Registry mapping deny messages to stable rule provenance [D3].
 *
 * OPA returns deny as a set of message strings (the rego rule bodies).
 * This registry is the single source of truth for rule_id + family + severity,
 * so audits trace decision → rule → source line. Messages not in the registry
 * fall back to a synthesized `custom:<hash>` id with family=custom.
 *
 * Multiple rules MAY share an identical message (e.g. the four
 * tmux/pkill/killall session-kill rules all carry the same verbatim reason
 * text). Such collisions are stored as a list and resolved by family hint
 * (inferred from the parsed program) when one is supplied to lookup().
 *
 * Keeping this in TS (not rego) is intentional: rego is the policy, this is the
 * provenance metadata layer. DRY — one canonical list, consumed by the builder.
 */
export class RuleRegistry {
  private readonly byMessage: Map<string, RuleMeta[]>;

  constructor(rules: readonly RuleMeta[]) {
    this.byMessage = new Map<string, RuleMeta[]>();
    for (const r of rules) {
      const arr = this.byMessage.get(r.message) ?? [];
      arr.push(r);
      this.byMessage.set(r.message, arr);
    }
  }

  /**
   * Look up metadata for a deny message; synthesizes a custom entry if unknown.
   *
   * Collision resolution order when several registered rules share the same
   * message:
   *   1. `familyHint` (inferred from the parsed program) narrows to that family.
   *   2. `parsedArgs` narrows further to a candidate whose `matchArgs` intersects
   *      the parsed args (for rules that share message AND family, e.g. the two
   *      tmux kill-* rules).
   *   3. Otherwise the first remaining candidate is returned.
   */
  lookup(deny: RawDeny, familyHint?: string, parsedArgs?: readonly string[]): RuleMeta {
    const candidates = this.byMessage.get(deny.message);
    if (candidates && candidates.length > 0) {
      let pool = candidates;
      if (familyHint) {
        const byFamily = pool.filter((c) => c.family === familyHint);
        if (byFamily.length > 0) pool = byFamily;
      }
      if (parsedArgs && pool.length > 1) {
        const byArgs = pool.filter((c) => c.matchArgs?.some((t) => parsedArgs.includes(t)));
        if (byArgs.length > 0) pool = byArgs;
      }
      return pool[0];
    }
    return {
      ruleId: `custom:${hashMessage(deny.message)}`,
      family: 'custom',
      message: deny.message,
    };
  }

  /** True if the message is a known registered rule. */
  isKnown(message: string): boolean {
    return this.byMessage.has(message);
  }
}

function hashMessage(msg: string): string {
  // Simple stable hash for synthesis — not cryptographic.
  let h = 0;
  for (let i = 0; i < msg.length; i++) {
    h = (Math.imul(31, h) + msg.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
