/**
 * OpenTelemetry (OTLP/HTTP) audit sink [LD-Y2 sink seam].
 *
 * Implements the pi `AuditSink` interface (`{ write }` from src/pi/audit.ts)
 * and POSTs an OTLP Logs JSON document to a collector endpoint. OTLP-over-HTTP
 * is the canonical transport for logs (see OTel spec). Network failure is
 * non-fatal: write() catches and resolves, mirroring the filesystem sink's
 * graceful-degradation contract.
 *
 * Keys never enter OPA, and secrets are redacted upstream (src/pi/audit.ts)
 * before reaching this sink; this layer performs no redaction itself.
 */
import type { AuditSink } from '../pi/audit.ts';

export interface OtlpAuditSinkOptions {
  /** OTLP/HTTP logs endpoint, e.g. http://otel:4318/v1/logs. */
  readonly endpoint: string;
  /** service.name resource attribute. Default 'pi-opa-net'. */
  readonly serviceName?: string;
  /** Extra request headers (auth, tenant, ...). */
  readonly headers?: Record<string, string>;
}

/** Shape produced by writeAuditEntry (src/pi/audit.ts AuditEntry). */
type AuditEntry = {
  readonly decision_id?: string;
  readonly decision?: string;
  readonly source?: string;
  readonly command?: string;
  readonly rule_ids?: readonly string[];
  readonly evaluated_at?: string;
  readonly [k: string]: unknown;
};

/** OTLP any-value helper. */
function stringValue(v: unknown): { stringValue: string } {
  return { stringValue: typeof v === 'string' ? v : String(v ?? '') };
}

/**
 * OTLP/HTTP audit sink. POSTs each decision as an OTLP Logs logRecord.
 */
export class OtlpAuditSink implements AuditSink {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly headers: Record<string, string>;

  constructor(opts: OtlpAuditSinkOptions) {
    this.endpoint = opts.endpoint;
    this.serviceName = opts.serviceName ?? 'pi-opa-net';
    this.headers = { ...(opts.headers ?? {}) };
  }

  async write(entry: unknown): Promise<void> {
    const body = this.buildOtlpBody(entry as AuditEntry);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Audit export failure is non-fatal — log to stderr and continue.
      console.error(
        `[pi-opa-net] OTLP audit export failed, continuing without OTel: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Build the OTLP Logs JSON document for a single audit entry. */
  private buildOtlpBody(entry: AuditEntry): Record<string, unknown> {
    const decision = entry.decision ?? '';
    const severityText = decision === 'deny' ? 'ERROR' : 'INFO';

    // kvlistValue mirrors the filesystem audit line shape 1:1.
    const kvValues = [
      { key: 'decision_id', value: stringValue(entry.decision_id) },
      { key: 'decision', value: stringValue(entry.decision) },
      { key: 'source', value: stringValue(entry.source) },
      { key: 'command', value: stringValue(entry.command) },
      {
        key: 'rule_ids',
        value: {
          arrayValue: {
            values: Array.isArray(entry.rule_ids) ? entry.rule_ids.map((r) => stringValue(r)) : [],
          },
        },
      },
      { key: 'evaluated_at', value: stringValue(entry.evaluated_at) },
    ];

    return {
      resourceLogs: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: stringValue(this.serviceName) }],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(Date.now() * 1_000_000),
                  severityText,
                  attributes: [{ key: 'decision', value: stringValue(decision) }],
                  body: { kvlistValue: { values: kvValues } },
                },
              ],
            },
          ],
        },
      ],
    };
  }
}
