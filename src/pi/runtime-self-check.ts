/**
 * Layer A4 — runtime self-check.
 *
 * Lightweight verification that the pi-opa-net extension is wired correctly:
 *   1. hook-registered — tool_call hook has been registered (set by the loader)
 *   2. manifest-declared — package.json declares a non-empty pi.extensions array
 *   3. extension-default-export-is-function — first pi.extensions entry default-exports a function
 *
 * Mirrors the static discovery logic in tests/pi/extension-discovery.test.ts so the
 * checks stay in lockstep with what pi's loader actually inspects.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type SelfCheckEntry = { name: string; passed: boolean; message?: string };

type SelfCheckResult = { ok: boolean; checks: SelfCheckEntry[] };

const REPO_ROOT = resolve(import.meta.dir, '../../');

let hookRegistered = false;

/** Called by the extension loader after registerToolCallEvent succeeds. */
export function markHookRegistered(): void {
  hookRegistered = true;
}

/** True once the loader has registered the tool_call hook. */
export function isHookRegistered(): boolean {
  return hookRegistered;
}

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
}

function checkHookRegistered(): SelfCheckEntry {
  const passed = isHookRegistered();
  return {
    name: 'hook-registered',
    passed,
    message: passed ? 'tool_call hook registered' : 'tool_call hook not registered yet',
  };
}

function checkManifestDeclared(): SelfCheckEntry {
  try {
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: unknown };
    const passed = Array.isArray(pi.extensions) && (pi.extensions as unknown[]).length > 0;
    return {
      name: 'manifest-declared',
      passed,
      message: passed
        ? 'package.json pi.extensions declared'
        : 'package.json pi.extensions missing or empty',
    };
  } catch (err) {
    return { name: 'manifest-declared', passed: false, message: `read error: ${String(err)}` };
  }
}

async function checkExtensionDefaultExportIsFunction(): Promise<SelfCheckEntry> {
  try {
    const pkg = readPackageJson();
    const pi = (pkg.pi ?? {}) as { extensions?: string[] };
    const entries = pi.extensions ?? [];
    if (entries.length === 0) {
      return {
        name: 'extension-default-export-is-function',
        passed: false,
        message: 'no pi.extensions entries to inspect',
      };
    }
    const entry = entries[0];
    const resolved = `file://${resolve(REPO_ROOT, entry)}`;
    const mod = await import(resolved);
    const passed = typeof mod.default === 'function';
    return {
      name: 'extension-default-export-is-function',
      passed,
      message: passed
        ? `${entry} default export is a function`
        : `${entry} default export is not a function`,
    };
  } catch (err) {
    return {
      name: 'extension-default-export-is-function',
      passed: false,
      message: `import error: ${String(err)}`,
    };
  }
}

export async function runSelfCheck(): Promise<SelfCheckResult> {
  const checks = await Promise.all([
    checkHookRegistered(),
    checkManifestDeclared(),
    checkExtensionDefaultExportIsFunction(),
  ]);
  return { ok: checks.every((c) => c.passed), checks };
}

// Surface the real extension loader as this module's default so callers (and the
// self-check tests) can exercise the same registration path production uses.
export { default } from './index.ts';
