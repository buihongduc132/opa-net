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
  | 'custom';

export interface RuleMeta {
  readonly ruleId: string;
  readonly family: RuleFamily;
  readonly message: string;
  /** Safe alternatives for the "did you mean?" UX. Optional. */
  readonly suggestions?: readonly string[];
}

/**
 * Registry mapping deny messages to stable rule provenance [D3].
 *
 * OPA returns deny as a set of message strings (the rego rule bodies).
 * This registry is the single source of truth for rule_id + family + severity,
 * so audits trace decision → rule → source line. Messages not in the registry
 * fall back to a synthesized `custom:<hash>` id with family=custom.
 *
 * Keeping this in TS (not rego) is intentional: rego is the policy, this is the
 * provenance metadata layer. DRY — one canonical list, consumed by the builder.
 */
export class RuleRegistry {
  private readonly byMessage: Map<string, RuleMeta>;

  constructor(rules: readonly RuleMeta[]) {
    this.byMessage = new Map(rules.map((r) => [r.message, r]));
  }

  /** Look up metadata for a deny message; synthesizes a custom entry if unknown. */
  lookup(deny: RawDeny): RuleMeta {
    const found = this.byMessage.get(deny.message);
    if (found) return found;
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
