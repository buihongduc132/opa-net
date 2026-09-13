/**
 * Audit sink seam [D9 / LD-Y2].
 *
 * The decision record (stdout JSON) IS the audit surface in v1. The default
 * NoOpSink does nothing — no file, no network, no throw. Future sinks
 * (FileAppendSink, WebhookSink) swap in via config with zero pipeline changes.
 */

/** Record passed to AuditSink.onUnlock for each unlock event. */
export interface UnlockRecord {
  readonly ruleId: string;
  readonly unlockKeyId: string;
  readonly keyType: 'll' | 'ttl';
  readonly timestamp: string;
}

export interface AuditSink {
  onUnlock(record: UnlockRecord): void;
}

/** No-op default — side-effect-free. */
export class NoOpSink implements AuditSink {
  onUnlock(_record: UnlockRecord): void {
    // Intentionally empty — the decision record is the sole audit surface.
  }
}
