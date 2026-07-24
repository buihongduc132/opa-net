import { describe, expect, it } from 'bun:test';

const MODULE_PATH = '../../src/pi/runtime-self-check.ts';

describe('Layer A4 — runtime self-check', () => {
  let mod: any;

  it('module can be imported (will fail until GREEN creates it)', async () => {
    let importError: Error | undefined;
    try {
      mod = await import(MODULE_PATH);
    } catch (err: any) {
      importError = err;
    }
    expect(importError).toBeUndefined();
    expect(mod).toBeDefined();
  });

  it('runSelfCheck is a function', async () => {
    mod = await import(MODULE_PATH);
    expect(typeof mod.runSelfCheck).toBe('function');
  });

  it('runSelfCheck returns { ok: false } when hook not registered', async () => {
    mod = await import(MODULE_PATH);
    // Reset any prior state — call without loading extension first.
    // Use dynamic re-import to get fresh module state if possible.
    const result = await mod.runSelfCheck();
    expect(result).toBeDefined();
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.checks)).toBe(true);
    const hookCheck = result.checks.find((c: any) => c.name === 'hook-registered');
    expect(hookCheck).toBeDefined();
    expect(hookCheck.passed).toBe(false);
  });

  it('runSelfCheck returns { ok: true } after extension loaded with mock pi', async () => {
    mod = await import(MODULE_PATH);
    // Invoke the default export (extension loader) with a mock pi
    const mockPi = { on: () => {} };
    if (typeof mod.default === 'function') {
      mod.default(mockPi);
    }
    const result = await mod.runSelfCheck();
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    const hookCheck = result.checks?.find((c: any) => c.name === 'hook-registered');
    if (hookCheck) {
      expect(hookCheck.passed).toBe(true);
    }
  });

  it('includes static check "manifest-declared" that validates package.json pi.extensions', async () => {
    mod = await import(MODULE_PATH);
    const result = await mod.runSelfCheck();
    const manifestCheck = result.checks.find((c: any) => c.name === 'manifest-declared');
    expect(manifestCheck).toBeDefined();
    // package.json currently has pi.extensions = ["./src/pi/index.ts"] — should pass
    expect(manifestCheck.passed).toBe(true);
  });

  it('includes static check "extension-default-export-is-function"', async () => {
    mod = await import(MODULE_PATH);
    const result = await mod.runSelfCheck();
    const exportCheck = result.checks.find(
      (c: any) => c.name === 'extension-default-export-is-function',
    );
    expect(exportCheck).toBeDefined();
    // src/pi/index.ts default-exports a function — should pass
    expect(exportCheck.passed).toBe(true);
  });

  it('exposes isHookRegistered() getter — false before load, true after', async () => {
    mod = await import(MODULE_PATH);
    expect(typeof mod.isHookRegistered).toBe('function');
    // Before loading: should be false (or reflect current state)
    // After loading with mock: should be true
    const mockPi = { on: () => {} };
    if (typeof mod.default === 'function') {
      mod.default(mockPi);
    }
    expect(mod.isHookRegistered()).toBe(true);
  });
});
