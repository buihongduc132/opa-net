import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EngineConfig, configFromEnv, resolveOpaBinary } from '../../../src/config/Config.ts';

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

  // --- Regression: mise path resolution must VERIFY candidate exists ---

  it('returns "opa" when mise path does NOT exist', () => {
    const oldEnv = process.env.PI_OPA_BINARY;
    const oldHome = process.env.HOME;
    delete process.env.PI_OPA_BINARY;
    process.env.HOME = mkdtempSync(join(tmpdir(), 'pi-opa-nohome-'));
    try {
      expect(resolveOpaBinary()).toBe('opa');
    } finally {
      process.env.HOME = oldHome;
      if (oldEnv) process.env.PI_OPA_BINARY = oldEnv;
    }
  });

  // THE BUG CASE: mise dir exists, has a `latest/` subdir, but NO opa binary
  // inside. Previously this returned `<misePath>/latest/opa` (non-existent)
  // -> engine spawned ENOENT -> fail-open in 0ms.
  it('returns "opa" when mise path exists but no real opa binary is present (THE BUG)', () => {
    const oldEnv = process.env.PI_OPA_BINARY;
    const oldHome = process.env.HOME;
    delete process.env.PI_OPA_BINARY;
    const tmpHome = mkdtempSync(join(tmpdir(), 'pi-opa-fakemise-'));
    const misePath = join(tmpHome, '.local/share/mise/installs/opa');
    mkdirSync(join(misePath, 'latest'), { recursive: true });
    process.env.HOME = tmpHome;
    try {
      const result = resolveOpaBinary();
      expect(result).toBe('opa');
      expect(existsSync(result) === false || result === 'opa').toBe(true);
    } finally {
      process.env.HOME = oldHome;
      if (oldEnv) process.env.PI_OPA_BINARY = oldEnv;
    }
  });

  it('returns the real mise candidate when a semver opa install exists', () => {
    const oldEnv = process.env.PI_OPA_BINARY;
    const oldHome = process.env.HOME;
    delete process.env.PI_OPA_BINARY;
    const tmpHome = mkdtempSync(join(tmpdir(), 'pi-opa-realmise-'));
    const misePath = join(tmpHome, '.local/share/mise/installs/opa');
    const semver = '1.2.3';
    mkdirSync(join(misePath, semver), { recursive: true });
    writeFileSync(join(misePath, semver, 'opa'), '#!/bin/sh\necho fake opa\n');
    process.env.HOME = tmpHome;
    try {
      const expected = join(misePath, semver, 'opa');
      expect(resolveOpaBinary()).toBe(expected);
      expect(existsSync(expected)).toBe(true);
    } finally {
      process.env.HOME = oldHome;
      if (oldEnv) process.env.PI_OPA_BINARY = oldEnv;
    }
  });
});

describe('configFromEnv', () => {
  it('defaults: failMode open, timeout 5000, cacheTtl 0', () => {
    const old = process.env.PI_OPA_FAIL_MODE;
    delete process.env.PI_OPA_FAIL_MODE;
    try {
      const c = configFromEnv('/p/safety.rego');
      expect(c.failMode).toBe('open');
      expect(c.timeoutMs).toBe(5000);
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
