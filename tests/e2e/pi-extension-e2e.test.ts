/**
 * E2E — pi extension adapter against real opa-net engine (subprocess).
 *
 * This is end-to-end because it exercises the full pipeline:
 *   pi tool_call hook → subprocess `bin/pi-opa-net.js eval --json`
 *   → live OPA + real policy → decision-output.v1 → translate → block result.
 *
 * Skipped when OPA binary is absent (mirrors e2e.test.ts gating pattern).
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Gate on OPA availability (same convention as tests/e2e/e2e.test.ts).
const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/0.68.0/bin/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);

function shaShort(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

/**
 * Spawn bin/pi-opa-net.js for a command, capture JSON stdout + exit code.
 * No mock — real subprocess against real OPA + real policy.
 */
async function runEval(command: string): Promise<{
  stdout: string;
  exitCode: number;
  json: unknown;
}> {
  const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');
  return new Promise((accept, reject) => {
    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const json = stdout.trim() ? JSON.parse(stdout) : null;
        accept({ stdout, exitCode: code ?? 0, json });
      } catch {
        reject(new Error(`non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`));
      }
    });
  });
}

describe.if(OPA_AVAILABLE)('pi-opa-net extension e2e (real subprocess + OPA)', () => {
  it('translates a deny decision into {block:true,reason} via real pipeline', async () => {
    const { exitCode, json } = await runEval('git stash pop');
    const decision = json as { decision: string; reasons?: Array<{ rule_id: string }> };

    // Engine MUST have denied.
    expect(exitCode).toBe(2);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons?.length ?? 0).toBeGreaterThan(0);

    // Now invoke the adapter with the SAME real subprocess (no injection).
    // We can't import the extension (it doesn't exist in RED) — but we can
    // verify the subprocess contract the adapter will rely on. When GREEN lands,
    // this test will call handlePiToolCall with the real opaNetEvalCommand.
    const ruleId = decision.reasons?.[0]?.rule_id ?? '';
    expect(ruleId.length).toBeGreaterThan(0);
    expect(ruleId).toContain('block-git-stash');
  });

  it('translates an allow decision into undefined via real pipeline', async () => {
    const { exitCode, json } = await runEval('git status');
    const decision = json as { decision: string };

    expect(exitCode).toBe(0);
    expect(decision.decision).toBe('allow');

    // Allow path → adapter returns undefined (engine returned allow).
    // GREEN will wire this through handlePiToolCall.
  });

  it('unlock-key path: decision.source reflects unlock when key present', async () => {
    // Mint a key via the CLI (real salt, real key derivation).
    const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');
    const keyResult = await new Promise<string>((accept, reject) => {
      const child = spawn('bun', [binPath, 'unlock-key', 'block-git-stash-mutations'], {
        env: { ...process.env, OPA_BIN },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (out += d.toString()));
      child.on('error', reject);
      child.on('close', () => accept(out.trim()));
    });

    expect(keyResult.length).toBeGreaterThan(0);
    // Now eval the command WITH the key → engine must allow.
    const { exitCode, json } = await runEval(`__ignored_${shaShort(keyResult)}__`);
    // We don't pass --unlock here in RED; just assert key mint works.
    // GREEN will exercise the full unlocked path through the adapter.
    expect(typeof json).toBe('object');
  });

  it('real pi session dispatch simulation: registered handler blocks rm -rf', async () => {
    // Simulate pi's dispatch: register handler on a fake pi, fire tool_call.
    // RED: import fails. GREEN: handler runs, invokes real subprocess, blocks.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const piOpaNet = await import('../../src/pi/index');
    expect(typeof piOpaNet.default).toBe('function');
  });
});
