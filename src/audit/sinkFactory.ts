/**
 * Config-driven audit sink factory [LD-Y2 sink seam].
 *
 * Decides which sink(s) to wire based on environment:
 *   - PIOPANET_OTEL_ENABLED=1 + PIOPANET_OTEL_ENDPOINT → MultiSink(filesystem + OTLP)
 *   - PIOPANET_OTEL_ENABLED=1 + no endpoint            → filesystem only (stderr warn)
 *   - otherwise                                        → filesystem only (backward compat)
 *
 * This keeps OPA keys out of config (keys live in audit records) and preserves
 * the existing filesystem-only behavior when OpenTelemetry is disabled.
 */
import { createFilesystemAuditSink } from '../pi/audit.ts';
import type { AuditSink } from '../pi/audit.ts';
import { MultiSink } from './MultiSink.ts';
import { OtlpAuditSink } from './OtlpAuditSink.ts';

export interface CreateAuditSinkOptions {
  /** Working directory used by the filesystem sink. */
  readonly cwd: string;
  /** Environment source. Defaults to process.env when omitted. */
  readonly env?: NodeJS.ProcessEnv;
}

const DEFAULT_SERVICE_NAME = 'pi-opa-net';

/**
 * Parse a 'k=v,k2=v2' header string into a Record. Whitespace tolerated.
 */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue; // skip malformed / empty-key entries
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key.length > 0) out[key] = val;
  }
  return out;
}

/**
 * Build the audit sink stack from environment. When OpenTelemetry is enabled
 * AND an endpoint is configured, returns a MultiSink fanning out to both the
 * filesystem sink and the OTLP sink. Otherwise returns the filesystem sink
 * alone, preserving the pre-OTel behavior.
 */
export function createAuditSink(opts: CreateAuditSinkOptions): AuditSink {
  const env = opts.env ?? process.env;
  const fsSink = createFilesystemAuditSink(opts.cwd);

  const otelEnabled = env.PIOPANET_OTEL_ENABLED === '1';
  const endpoint = env.PIOPANET_OTEL_ENDPOINT;
  if (!otelEnabled || !endpoint) {
    if (otelEnabled && !endpoint) {
      console.error(
        '[pi-opa-net] PIOPANET_OTEL_ENABLED=1 but PIOPANET_OTEL_ENDPOINT unset; falling back to filesystem audit only',
      );
    }
    return fsSink;
  }

  const serviceName = env.PIOPANET_OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
  const headers = parseHeaders(env.PIOPANET_OTEL_HEADERS);
  const otlpSink = new OtlpAuditSink({ endpoint, serviceName, headers });
  return new MultiSink([fsSink, otlpSink]);
}
