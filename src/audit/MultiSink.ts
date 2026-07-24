/**
 * Fan-out MultiSink for the pi audit surface [LD-Y2 sink seam].
 *
 * Implements the pi `AuditSink` interface and dispatches each write() to N
 * children. Failure of any one child is non-blocking: catch → log → continue,
 * mirroring the filesystem + OTLP sinks' own graceful-degradation contracts.
 * This enables filesystem + OTel logging simultaneously without one breaking
 * the other.
 */
import type { AuditSink } from '../pi/audit.ts';

export class MultiSink implements AuditSink {
  private readonly children: readonly AuditSink[];

  constructor(children: readonly AuditSink[]) {
    this.children = children;
  }

  async write(entry: unknown): Promise<void> {
    // Sequential fan-out so a throwing child cannot starve later children of
    // the write (Promise.all would short-circuit scheduling on reject).
    for (const child of this.children) {
      try {
        await child.write(entry);
      } catch (err) {
        console.error(
          `[pi-opa-net] audit sink child failed, continuing: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
