import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V1 bypass fix — drop spoofable OPA_GATE_INTERNAL guard', () => {
  const root = resolve(import.meta.dir, '../../..');
  const shimPath = resolve(root, 'scripts/.opa-gate-shim');
  const auditAppendPath = resolve(root, 'scripts/opa-gate-audit-append');

  test('.opa-gate-shim does NOT contain OPA_GATE_INTERNAL check, export, or unset', () => {
    const content = readFileSync(shimPath, 'utf8');
    expect(content).not.toContain('OPA_GATE_INTERNAL');
  });

  test('opa-gate-audit-append does NOT contain OPA_GATE_INTERNAL export', () => {
    const content = readFileSync(auditAppendPath, 'utf8');
    expect(content).not.toContain('OPA_GATE_INTERNAL');
  });
});
