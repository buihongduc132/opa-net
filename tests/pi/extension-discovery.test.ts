import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
}

describe('pi-opa-net extension discovery (pi loader contract)', () => {
  it('package.json declares pi.extensions array (non-empty)', () => {
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: unknown };
    expect(Array.isArray(pi.extensions)).toBe(true);
    expect((pi.extensions as unknown[]).length).toBeGreaterThan(0);
  });

  it('every declared pi.extensions entry exists on disk', async () => {
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: string[] };
    const entries = pi.extensions ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const resolved = resolve(REPO_ROOT, entry);
      expect(existsSync(resolved)).toBe(true);
    }
  });

  it('every declared pi.extensions entry default-exports a function', async () => {
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: string[] };
    const entries = pi.extensions ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const resolved = `file://${resolve(REPO_ROOT, entry)}`;
      const mod = await import(resolved);
      expect(typeof mod.default).toBe('function');
    }
  });

  it('simulates pi resolveExtensionEntries: returns at least one entry', () => {
    // Mirrors pi-coding-agent's resolveExtensionEntries() logic.
    // Returns array of resolved entry paths, or null if none found.
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: string[] };
    const entries: string[] = [];
    if (Array.isArray(pi.extensions)) {
      for (const entry of pi.extensions) {
        const resolved = resolve(REPO_ROOT, entry);
        if (existsSync(resolved)) entries.push(resolved);
      }
    }
    const result = entries.length > 0 ? entries : null;
    expect(result).not.toBeNull();
    expect((result as string[]).length).toBeGreaterThan(0);
  });
});
