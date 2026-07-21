import type { DecisionOutput } from '../output/DecisionBuilder.ts';

/**
 * Audit sink bridge — writes one JSONL line per decision.
 *
 * Test/unit injectable: tests pass an `auditSink` with a captured `write`.
 * Production wires this to a real filesystem sink (JSONL append).
 */
export interface AuditSink {
  write: (entry: unknown) => Promise<void>;
}

export interface WriteAuditEntryInput {
  sessionId: string | undefined;
  decision: Pick<
    DecisionOutput,
    'decision' | 'source' | 'reasons' | 'input' | 'evaluated_at' | 'decision_id'
  >;
  auditSink: AuditSink;
}

interface AuditEntry {
  decision_id: string;
  decision: string;
  source: string;
  command: string;
  rule_ids: string[];
  evaluated_at: string;
}

/**
 * Redact common secret patterns from a command string before audit.
 * - Bearer tokens / Authorization headers
 * - API keys (sk-... long hex/alnum)
 */
export function redactSecrets(text: string): string {
  let out = text;
  // Authorization: Bearer <token>
  out = out.replace(/(Bearer\s+)([A-Za-z0-9._\-]+)/gi, '$1[REDACTED]');
  // Generic sk-<token> (Stripe/Anthropic/etc API keys)
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{6,}/g, 'sk-[REDACTED]');
  return out;
}

export async function writeAuditEntry(input: WriteAuditEntryInput): Promise<void> {
  if (!input.sessionId) return;

  const entry: AuditEntry = {
    decision_id: input.decision.decision_id,
    decision: input.decision.decision,
    source: input.decision.source,
    command: redactSecrets(input.decision.input.raw),
    rule_ids: input.decision.reasons.map((r) => r.rule_id),
    evaluated_at: input.decision.evaluated_at,
  };

  await input.auditSink.write(entry);
}
