import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';

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

function runPiSession(
  prompt: string,
  timeoutMs = 90_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi session timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const child = spawn('pi', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
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
  }, 90_000);

  it('pi allows git status (output does NOT contain BLOCKED)', async () => {
    const { stdout, stderr } = await runPiSession('run this bash command exactly: git status');
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).not.toContain('blocked');
  }, 90_000);

  it('pi blocks git reset --hard HEAD (output contains BLOCKED)', async () => {
    const { stdout, stderr } = await runPiSession(
      'run this bash command exactly: git reset --hard HEAD',
    );
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).toContain('blocked');
  }, 90_000);
});

if (shouldSkip) {
  const reason = skipEnv ? 'PIOPANET_SKIP_PI_SMOKE=1 set' : 'pi binary not on PATH';
  describe.skip(`Layer A1 — pi-session E2E smoke: ${reason}`, () => {});
}
