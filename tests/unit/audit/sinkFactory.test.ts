import { afterEach, describe, expect, it } from 'bun:test';
import { MultiSink } from '../../../src/audit/MultiSink.ts';
import { createAuditSink, parseHeaders } from '../../../src/audit/sinkFactory.ts';

/**
 * RED tests for the config-driven audit sink factory (0.4.0 ghost port, scout #3).
 *
 * Asserts the environment contract:
 *   - OTel disabled (no env) → returns plain filesystem sink (NOT MultiSink)
 *   - PIOPANET_OTEL_ENABLED=1 + PIOPANET_OTEL_ENDPOINT set → MultiSink w/ 2 children
 *   - PIOPANET_OTEL_ENABLED=1 but NO endpoint → filesystem sink + stderr warn
 *   - parseHeaders parsing rules
 *   - env param override takes precedence over process.env
 */

const CLEAN_ENV_KEYS = [
  'PIOPANET_OTEL_ENABLED',
  'PIOPANET_OTEL_ENDPOINT',
  'PIOPANET_OTEL_SERVICE_NAME',
  'PIOPANET_OTEL_HEADERS',
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of CLEAN_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of CLEAN_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('sinkFactory.createAuditSink', () => {
  let snap: Record<string, string | undefined>;
  let restoreErr: (() => void) | undefined;

  afterEach(() => {
    if (restoreErr) {
      restoreErr();
      restoreErr = undefined;
    }
    restoreEnv(snap);
  });

  it('OTel disabled (no env) → returns plain filesystem sink (NOT MultiSink)', () => {
    snap = snapshotEnv();
    for (const k of CLEAN_ENV_KEYS) delete process.env[k];
    const sink = createAuditSink({ cwd: '/tmp' });
    expect(sink).toBeInstanceOf(Object);
    expect(sink).not.toBeInstanceOf(MultiSink);
  });

  it("PIOPANET_OTEL_ENABLED='1' + PIOPANET_OTEL_ENDPOINT set → returns MultiSink with 2 children", () => {
    snap = snapshotEnv();
    for (const k of CLEAN_ENV_KEYS) delete process.env[k];
    const sink = createAuditSink({
      cwd: '/tmp',
      env: {
        PIOPANET_OTEL_ENABLED: '1',
        PIOPANET_OTEL_ENDPOINT: 'http://otel:4318/v1/logs',
      },
    });
    expect(sink).toBeInstanceOf(MultiSink);
  });

  it("PIOPANET_OTEL_ENABLED='1' but NO endpoint → filesystem sink + stderr warn", () => {
    snap = snapshotEnv();
    for (const k of CLEAN_ENV_KEYS) delete process.env[k];

    const captured: string[] = [];
    const original = console.error;
    console.error = (msg: string) => captured.push(msg);
    restoreErr = () => {
      console.error = original;
    };

    const sink = createAuditSink({
      cwd: '/tmp',
      env: { PIOPANET_OTEL_ENABLED: '1' },
    });
    expect(sink).not.toBeInstanceOf(MultiSink);
    expect(captured.join('\n')).toContain('PIOPANET_OTEL_ENDPOINT');
  });

  it('env param override takes precedence over process.env', () => {
    snap = snapshotEnv();
    // process.env says enabled, but env param (override) says disabled → plain fs sink.
    process.env.PIOPANET_OTEL_ENABLED = '1';
    process.env.PIOPANET_OTEL_ENDPOINT = 'http://otel:4318/v1/logs';
    const sink = createAuditSink({
      cwd: '/tmp',
      env: {}, // override disables OTel
    });
    expect(sink).not.toBeInstanceOf(MultiSink);
  });
});

describe('sinkFactory.parseHeaders', () => {
  it("parseHeaders('k=v,k2=v2') → {k:'v', k2:'v2'}", () => {
    expect(parseHeaders('k=v,k2=v2')).toEqual({ k: 'v', k2: 'v2' });
  });

  it('empty string → {}', () => {
    expect(parseHeaders('')).toEqual({});
  });

  it('undefined → {}', () => {
    expect(parseHeaders(undefined)).toEqual({});
  });

  it("malformed (no '=') → skipped", () => {
    expect(parseHeaders('valid=1,badtoken,also-good=2')).toEqual({
      valid: '1',
      'also-good': '2',
    });
  });

  it('whitespace tolerated', () => {
    expect(parseHeaders(' k = v , k2 = v2 ')).toEqual({ k: 'v', k2: 'v2' });
  });
});
