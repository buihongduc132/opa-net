/**
 * RED tests for block-rm-rf-dangerous-target (0.4.0 ghost port, scout #5, #7, #8).
 *
 * Uses the real engine evaluation harness (subprocess `bin/pi-opa-net.js eval --json`
 * against live OPA + policy), mirroring tests/e2e/cli-contract.test.ts.
 *
 * Test matrix (from port plan §8):
 *   - rm -rf /                  → DENY
 *   - rm -rf ~                  → DENY
 *   - rm -rf .                  → DENY
 *   - rm -rf ..                 → DENY
 *   - rm -rf /*                 → DENY (raw-regex path; shell-quote expands /* away)
 *   - rm -rf $HOME              → DENY (raw-regex path)
 *   - rm -rf /home              → DENY
 *   - rm -rf /tmp/specific-dir  → ALLOW (safe carve-out)
 *   - rm -rf ./subdir           → ALLOW (safe carve-out)
 *   - rm -r /                   → ALLOW (rule requires BOTH recursive AND force)
 *   - rm -rf -rf /              → DENY (short-flag cluster)
 *
 * RED note: the rule is absent from both catalog.ts and safety.rego on repo main.
 * DENY cases fail because eval returns allow (no rule fires). ALLOW carve-out
 * cases would pass vacuously (rule absent → nothing blocks them), so each test
 * first asserts the rule IS registered in the catalog — that precondition fails
 * in RED, forcing every test red until the rule lands in both catalog + rego.
 */
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RULES } from '../../src/rules/index.ts';

const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/1.18.2/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);
const SKIP_REASON = !OPA_AVAILABLE ? 'OPA binary not found' : '';

const RULE_ID = 'block-rm-rf-dangerous-target';

/** RED gate: fails until the rule is registered in the catalog. */
function expectRuleRegistered(): void {
  const ids = RULES.map((r) => r.ruleId);
  expect(ids, `catalog must register ${RULE_ID}`).toContain(RULE_ID);
}

interface EvalResult {
  exitCode: number;
  json: { decision?: string; action?: string; [k: string]: unknown };
}

function runEval(command: string, timeoutMs = 15000): Promise<EvalResult> {
  return new Promise((accept, reject) => {
    const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');
    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const json = stdout.trim() ? JSON.parse(stdout.trim()) : {};
        accept({ exitCode: code ?? 0, json });
      } catch {
        reject(new Error(`non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`));
      }
    });
  });
}

describe.if(!SKIP_REASON)('block-rm-rf-dangerous-target', () => {
  it('is registered in the rule catalog', () => {
    expectRuleRegistered();
  });

  // ── DENY cases (eval must deny) ──
  const DENY_CASES = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf .',
    'rm -rf ..',
    'rm -rf /*',
    'rm -rf $HOME',
    'rm -rf /home',
    'rm -rf -rf /',
    'rm -fr /', // reversed short-flag cluster
  ];

  for (const cmd of DENY_CASES) {
    it(`${cmd} → DENY`, async () => {
      expectRuleRegistered();
      const { json } = await runEval(cmd);
      expect(json.decision).toBe('deny');
      expect(json.action).toBe('block');
    });
  }

  // ── ALLOW carve-out cases (must NOT be blocked by this rule) ──
  const ALLOW_CASES = [
    'rm -rf /tmp/specific-dir',
    'rm -rf ./subdir',
    'rm -r /', // no -f → rule requires BOTH recursive AND force
  ];

  for (const cmd of ALLOW_CASES) {
    it(`${cmd} → ALLOW`, async () => {
      // Precondition: rule must be loaded; carve-out only meaningful once it exists.
      expectRuleRegistered();
      const { json } = await runEval(cmd);
      expect(json.decision).toBe('allow');
    });
  }
});

if (SKIP_REASON) {
  describe.skip(`block-rm-rf-dangerous-target: ${SKIP_REASON}`, () => {});
}
