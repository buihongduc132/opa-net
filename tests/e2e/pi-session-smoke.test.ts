import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Check prerequisites once at top
let piAvailable = false;
try {
  piAvailable = await new Promise<boolean>((res) => {
    const child = spawn('which', ['pi']);
    child.on('close', (code) => res(code === 0));
    child.on('error', () => res(false));
  });
} catch {
  piAvailable = false;
}

const skipEnv = process.env.PIOPANET_SKIP_PI_SMOKE === '1';
const shouldSkip = !piAvailable || skipEnv;

/**
 * Spawn a pi -p session in an ISOLATED clean temp cwd.
 *
 * Rationale: pi's higher-level safety reasoning (advisory on uncommitted work,
 * destructive-command guardrails) fires BEFORE the pi-opa-net extension's BLOCK
 * when the cwd has uncommitted changes or is a sensitive repo. Running in a
 * pristine temp dir ensures the BLOCK comes from pi-opa-net itself, not from
 * pi's advisory layer — that's what this smoke test is verifying.
 */
function runPiSession(
  prompt: string,
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((accept, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'piopa-smoke-'));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi session timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const child = spawn('pi', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
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
      accept({ stdout, stderr, exitCode: code });
    });
  });
}

describe.skipIf(shouldSkip)('Layer A1 — pi-session E2E smoke (release gate)', () => {
  it('pi blocks git stash pop (output contains BLOCKED)', async () => {
    const { stdout, stderr } = await runPiSession('run this bash command exactly: git stash pop');
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).toContain('blocked');
  }, 120_000);

  it('pi allows git status (output does NOT contain BLOCKED)', async () => {
    const { stdout, stderr } = await runPiSession('run this bash command exactly: git status');
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).not.toContain('blocked');
  }, 120_000);

  it('pi blocks git reset --hard HEAD (output contains BLOCKED)', async () => {
    const { stdout, stderr } = await runPiSession(
      'run this bash command exactly: git reset --hard HEAD',
    );
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).toContain('blocked');
  }, 120_000);
});

if (shouldSkip) {
  const reason = skipEnv ? 'PIOPANET_SKIP_PI_SMOKE=1 set' : 'pi binary not on PATH';
  describe.skip(`Layer A1 — pi-session E2E smoke: ${reason}`, () => {});
}
