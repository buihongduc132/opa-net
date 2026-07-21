/**
 * RED PHASE — audit sink bridge for the pi extension.
 *
 * The pi extension writes one JSONL line per decision to the audit sink
 * (sessionId-derived) carrying: decision_id, decision, source, command,
 * rule_ids[], evaluated_at. Secrets in the command field are redacted.
 */
import { describe, expect, it } from 'bun:test';
import { writeAuditEntry } from '../../src/pi/audit';

describe('pi-opa-net audit bridge', () => {
  it('writes a JSONL line with required fields when sessionId present', async () => {
    const written: unknown[] = [];
    await writeAuditEntry({
      sessionId: '/tmp/fake-session.jsonl',
      decision: {
        decision: 'deny',
        source: 'opa',
        reasons: [
          { rule_id: 'block-git-stash-mutations', message: 'stash', family: 'git', severity: 'block' },
        ],
        input: { raw: 'git stash pop' },
        evaluated_at: '2026-07-21T14:00:00.000Z',
        decision_id: '11111111-2222-3333-4444-555555555555',
      } as never,
      auditSink: {
        write: (entry: unknown) => {
          written.push(entry);
          return Promise.resolve();
        },
      },
    });
    expect(written.length).toBe(1);
    const entry = written[0] as Record<string, unknown>;
    expect(entry.decision_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(entry.decision).toBe('deny');
    expect(entry.source).toBe('opa');
    expect(entry.command).toBe('git stash pop');
    expect(Array.isArray(entry.rule_ids)).toBe(true);
    expect(entry.rule_ids).toContain('block-git-stash-mutations');
    expect(entry.evaluated_at).toBe('2026-07-21T14:00:00.000Z');
  });

  it('skips write when sessionId absent', async () => {
    let called = false;
    await writeAuditEntry({
      sessionId: undefined,
      decision: {
        decision: 'allow',
        source: 'opa',
        reasons: [],
        input: { raw: 'ls' },
        evaluated_at: '2026-07-21T14:00:00.000Z',
        decision_id: '00000000-0000-0000-0000-000000000000',
      } as never,
      auditSink: {
        write: () => {
          called = true;
          return Promise.resolve();
        },
      },
    });
    expect(called).toBe(false);
  });

  it('redacts secrets in command field (token-like patterns)', async () => {
    const written: unknown[] = [];
    await writeAuditEntry({
      sessionId: '/tmp/fake-session.jsonl',
      decision: {
        decision: 'deny',
        source: 'opa',
        reasons: [],
        input: { raw: 'curl -H "Authorization: Bearer sk-secret-abc123" https://x' },
        evaluated_at: '2026-07-21T14:00:00.000Z',
        decision_id: '22222222-3333-4444-5555-666666666666',
      } as never,
      auditSink: {
        write: (entry: unknown) => {
          written.push(entry);
          return Promise.resolve();
        },
      },
    });
    const entry = written[0] as { command: string };
    expect(entry.command).not.toContain('sk-secret-abc123');
  });
});
