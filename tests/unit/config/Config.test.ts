import { describe, expect, it } from 'bun:test';
import { configFromEnv, resolveOpaBinary, type EngineConfig } from '../../../src/config/Config.ts';

describe('resolveOpaBinary', () => {
  it('returns explicit path when given', () => {
    expect(resolveOpaBinary('/custom/opa')).toBe('/custom/opa');
  });

  it('returns env var when set', () => {
    const old = process.env.PI_OPA_BINARY;
    process.env.PI_OPA_BINARY = '/env/opa';
    try {
      expect(resolveOpaBinary()).toBe('/env/opa');
    } finally {
      if (old) process.env.PI_OPA_BINARY = old;
      else delete process.env.PI_OPA_BINARY;
    }
  });

  it('falls back to a string when no explicit/env/mise path', () => {
    const old = process.env.PI_OPA_BINARY;
    delete process.env.PI_OPA_BINARY;
    try {
      const r = resolveOpaBinary();
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    } finally {
      if (old) process.env.PI_OPA_BINARY = old;
    }
  });
});

describe('configFromEnv', () => {
  it('defaults: failMode open, timeout 250, cacheTtl 0', () => {
    const old = process.env.PI_OPA_FAIL_MODE;
    delete process.env.PI_OPA_FAIL_MODE;
    try {
      const c = configFromEnv('/p/safety.rego');
      expect(c.failMode).toBe('open');
      expect(c.timeoutMs).toBe(250);
      expect(c.cacheTtlMs).toBe(0);
      expect(c.policyPath).toBe('/p/safety.rego');
    } finally {
      if (old) process.env.PI_OPA_FAIL_MODE = old;
    }
  });

  it('PI_OPA_FAIL_MODE=closed → failMode closed', () => {
    const old = process.env.PI_OPA_FAIL_MODE;
    process.env.PI_OPA_FAIL_MODE = 'closed';
    try {
      expect(configFromEnv('/p.rego').failMode).toBe('closed');
    } finally {
      if (old) process.env.PI_OPA_FAIL_MODE = old;
      else delete process.env.PI_OPA_FAIL_MODE;
    }
  });

  it('PI_OPA_TIMEOUT_MS parsed as int', () => {
    const old = process.env.PI_OPA_TIMEOUT_MS;
    process.env.PI_OPA_TIMEOUT_MS = '999';
    try {
      expect(configFromEnv('/p.rego').timeoutMs).toBe(999);
    } finally {
      if (old) process.env.PI_OPA_TIMEOUT_MS = old;
      else delete process.env.PI_OPA_TIMEOUT_MS;
    }
  });

  it('honors hostname + sessionId env', () => {
    process.env.PI_OPA_HOSTNAME = 'box1';
    process.env.PI_OPA_SESSION_ID = 'ses_xyz';
    const c: EngineConfig = configFromEnv('/p.rego');
    expect(c.hostname).toBe('box1');
    expect(c.sessionId).toBe('ses_xyz');
    delete process.env.PI_OPA_HOSTNAME;
    delete process.env.PI_OPA_SESSION_ID;
  });
});
