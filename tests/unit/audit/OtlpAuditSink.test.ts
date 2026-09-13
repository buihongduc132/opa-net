import { afterEach, describe, expect, it } from 'bun:test';
import { OtlpAuditSink } from '../../../src/audit/OtlpAuditSink.ts';

/**
 * RED tests for the OTLP/HTTP audit sink (0.4.0 ghost port, scout #2).
 *
 * Mocks globalThis.fetch to assert:
 *   - OTLP Logs JSON body shape (resourceLogs → scopeLogs → logRecords)
 *   - deny → severityText "ERROR"; allow → "INFO"
 *   - resource.service.name = serviceName (default 'pi-opa-net', override works)
 *   - logRecord body kvlistValue keys: decision_id, decision, source, command,
 *     rule_ids, evaluated_at
 *   - fetch called with endpoint URL, method POST, content-type application/json,
 *     custom headers
 *   - fetch rejects → write still resolves (no throw), stderr logged
 */
interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installFetchMock(opts?: { rejectWith?: Error }): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (opts?.rejectWith) return Promise.reject(opts.rejectWith);
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const SAMPLE_DENY = {
  decision_id: 'abc123',
  decision: 'deny',
  source: 'fail-closed',
  command: 'rm -rf /',
  rule_ids: ['block-rm-rf-dangerous-target'],
  evaluated_at: '2026-07-24T00:00:00Z',
  pi_opa_net_version: '0.4.0',
};

const SAMPLE_ALLOW = {
  ...SAMPLE_DENY,
  decision: 'allow',
};

describe('OtlpAuditSink', () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it('write builds OTLP Logs JSON body (resourceLogs → scopeLogs → logRecords)', async () => {
    const mock = installFetchMock();
    restoreFetch = mock.restore;
    const sink = new OtlpAuditSink({ endpoint: 'http://otel:4318/v1/logs' });
    await sink.write(SAMPLE_DENY);

    expect(mock.calls.length).toBe(1);
    const body = JSON.parse(String(mock.calls[0].init?.body));
    expect(body.resourceLogs).toBeInstanceOf(Array);
    expect(body.resourceLogs[0].scopeLogs).toBeInstanceOf(Array);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toBeInstanceOf(Array);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords.length).toBe(1);
  });

  it('deny entry → severityText "ERROR"; allow → "INFO"', async () => {
    const mock = installFetchMock();
    restoreFetch = mock.restore;
    const sink = new OtlpAuditSink({ endpoint: 'http://otel:4318/v1/logs' });

    await sink.write(SAMPLE_DENY);
    await sink.write(SAMPLE_ALLOW);

    const denyBody = JSON.parse(String(mock.calls[0].init?.body));
    const allowBody = JSON.parse(String(mock.calls[1].init?.body));
    expect(denyBody.resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('ERROR');
    expect(allowBody.resourceLogs[0].scopeLogs[0].logRecords[0].severityText).toBe('INFO');
  });

  it("resource.service.name = serviceName (default 'pi-opa-net', override works)", async () => {
    const mock = installFetchMock();
    restoreFetch = mock.restore;

    const defaultSink = new OtlpAuditSink({ endpoint: 'http://otel:4318/v1/logs' });
    const customSink = new OtlpAuditSink({
      endpoint: 'http://otel:4318/v1/logs',
      serviceName: 'custom-svc',
    });

    await defaultSink.write(SAMPLE_DENY);
    await customSink.write(SAMPLE_DENY);

    const defaultBody = JSON.parse(String(mock.calls[0].init?.body));
    const customBody = JSON.parse(String(mock.calls[1].init?.body));

    const defaultAttr = defaultBody.resourceLogs[0].resource.attributes.find(
      (a: { key: string }) => a.key === 'service.name',
    );
    const customAttr = customBody.resourceLogs[0].resource.attributes.find(
      (a: { key: string }) => a.key === 'service.name',
    );
    expect(defaultAttr?.value?.stringValue).toBe('pi-opa-net');
    expect(customAttr?.value?.stringValue).toBe('custom-svc');
  });

  it('logRecord body kvlistValue has keys: decision_id, decision, source, command, rule_ids, evaluated_at, pi_opa_net_version', async () => {
    const mock = installFetchMock();
    restoreFetch = mock.restore;
    const sink = new OtlpAuditSink({ endpoint: 'http://otel:4318/v1/logs' });
    await sink.write(SAMPLE_DENY);

    const body = JSON.parse(String(mock.calls[0].init?.body));
    const kv = body.resourceLogs[0].scopeLogs[0].logRecords[0].body.kvlistValue.values;
    const keys = kv.map((v: { key: string }) => v.key);
    expect(keys).toEqual([
      'decision_id',
      'decision',
      'source',
      'command',
      'rule_ids',
      'evaluated_at',
      'pi_opa_net_version',
    ]);

    // rule_ids serialized as arrayValue
    const ruleIdsEntry = kv.find((v: { key: string }) => v.key === 'rule_ids');
    expect(ruleIdsEntry.value.arrayValue.values[0].stringValue).toBe(
      'block-rm-rf-dangerous-target',
    );
  });

  it('fetch called with endpoint URL, method POST, content-type application/json, custom headers', async () => {
    const mock = installFetchMock();
    restoreFetch = mock.restore;
    const sink = new OtlpAuditSink({
      endpoint: 'http://otel:4318/v1/logs',
      headers: { Authorization: 'Bearer tok', 'x-tenant': 'acme' },
    });
    await sink.write(SAMPLE_DENY);

    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0].url).toBe('http://otel:4318/v1/logs');
    const init = mock.calls[0].init as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['x-tenant']).toBe('acme');
  });

  it('fetch rejects → write still resolves (no throw), stderr logged', async () => {
    const mock = installFetchMock({ rejectWith: new Error('network down') });
    restoreFetch = mock.restore;
    const originalErr = console.error;
    const captured: string[] = [];
    console.error = (msg: string) => captured.push(msg);

    const sink = new OtlpAuditSink({ endpoint: 'http://otel:4318/v1/logs' });
    try {
      // Must NOT throw — write resolves gracefully.
      await expect(sink.write(SAMPLE_DENY)).resolves.toBeUndefined();
      expect(mock.calls.length).toBe(1);
      const joined = captured.join('\n');
      expect(joined).toContain('[pi-opa-net]');
      expect(joined).toContain('network down');
    } finally {
      console.error = originalErr;
    }
  });
});
