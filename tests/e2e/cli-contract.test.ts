import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/1.18.2/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);

let BUN_AVAILABLE = false;
try {
  const check = await new Promise<boolean>((res) => {
    const child = spawn('which', ['bun']);
    child.on('close', (code) => res(code === 0));
    child.on('error', () => res(false));
  });
  BUN_AVAILABLE = check;
} catch {
  BUN_AVAILABLE = false;
}

const SKIP_REASON = !OPA_AVAILABLE
  ? 'OPA binary not found'
  : !BUN_AVAILABLE
    ? 'bun binary not found'
    : '';

const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');

interface EvalResult {
  exitCode: number;
  json: {
    decision?: string;
    action?: string;
    [key: string]: unknown;
  };
}

function runEval(command: string, timeoutMs = 15000): Promise<EvalResult> {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout after ${timeoutMs}ms for: ${command}`));
    }, timeoutMs);

    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN },
    });
    let stdout = '';
    let stderr = '';
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

describe.if(!SKIP_REASON)('Layer A3 — CLI contract tests (regression guard for C2)', () => {
  // Compound commands with env prefix
  it('export FOO=bar; git stash pop → exit 2, deny, block', async () => {
    const { exitCode, json } = await runEval('export FOO=bar; git stash pop');
    expect(exitCode).toBe(2);
    expect(json.decision).toBe('deny');
    expect(json.action).toBe('block');
  });

  it('export FOO=bar; git reset --hard → exit 2, deny, block', async () => {
    const { exitCode, json } = await runEval('export FOO=bar; git reset --hard');
    expect(exitCode).toBe(2);
    expect(json.decision).toBe('deny');
    expect(json.action).toBe('block');
  });

  it('export FOO=bar; git status → exit 0, allow', async () => {
    const { exitCode, json } = await runEval('export FOO=bar; git status');
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.action).toBe('allow');
  });

  it('export FOO=bar; ls -la → exit 0, allow', async () => {
    const { exitCode, json } = await runEval('export FOO=bar; ls -la');
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.action).toBe('allow');
  });

  // Plain commands (no env prefix)
  it('plain git stash pop → exit 2, deny, block', async () => {
    const { exitCode, json } = await runEval('git stash pop');
    expect(exitCode).toBe(2);
    expect(json.decision).toBe('deny');
    expect(json.action).toBe('block');
  });

  it('plain git status → exit 0, allow', async () => {
    const { exitCode, json } = await runEval('git status');
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.action).toBe('allow');
  });
});

if (SKIP_REASON) {
  describe.skip(`Layer A3 — CLI contract tests: ${SKIP_REASON}`, () => {});
}
