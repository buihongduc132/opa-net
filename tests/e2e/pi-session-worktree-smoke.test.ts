/**
 * Pi session smoke test for worktree/branch gating (t9).
 *
 * Spawns a REAL pi -p session in an isolated temp git repo on branch `main`,
 * triggers a `git checkout feature` command, and verifies the pi-opa-net
 * guard BLOCKS it with the branch-target-allowlist reason.
 *
 * This proves the FE→guard→deny path works: pi Shell tool call →
 * pi-opa-net tool_call hook → OPA eval → deny → block result in pi output.
 *
 * Prerequisites:
 *   - `pi` on PATH
 *   - OPA binary available
 *   - pi-opa-net installed in pi extensions (local override or deployed)
 *
 * Skip by default (PIOPANET_RUN_PI_SMOKE=1 to enable). Mirrors the gating
 * pattern of pi-session-smoke.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const smokeDir = resolve(import.meta.dir, '../../.pi-opa-net/smoke');

// Check prerequisites once at top.
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
const shouldSkip = !piAvailable || skipEnv || process.env.PIOPANET_RUN_PI_SMOKE !== '1';

/**
 * Spawn a pi -p session in an isolated temp cwd on branch main.
 */
function runPiSession(
  prompt: string,
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi session timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const child = spawn('pi', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, PIOPANET_DRY_RUN: '1' },
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

/** Write smoke proof to disk. */
function writeSmokeProof(name: string, data: Record<string, unknown>): void {
  mkdirSync(smokeDir, { recursive: true });
  writeFileSync(join(smokeDir, `${name}.jsonl`), JSON.stringify(data) + '\n');
}

describe.skipIf(shouldSkip)('pi session smoke: worktree/branch gating (t9)', () => {
  it('pi blocks git checkout to non-allowed branch from main worktree', async () => {
    // Create temp repo on main with a feature branch.
    const cwd = mkdtempSync(join(tmpdir(), 'pi-smoke-wt-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'smoke@test.com'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'smoke'], { cwd, stdio: 'ignore' });
      writeFileSync(join(cwd, 'README.md'), '# smoke\n');
      execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['branch', 'feature-evil'], { cwd, stdio: 'ignore' });

      // Run pi session that attempts to checkout the non-allowed branch.
      const result = await runPiSession(
        'Run this exact bash command and report the result: git checkout feature-evil',
        cwd,
      );

      writeSmokeProof('checkout-non-allowed', {
        timestamp: new Date().toISOString(),
        scenario: 'pi-smoke-checkout-non-allowed',
        cwd,
        exitCode: result.exitCode,
        stdout_tail: result.stdout.slice(-2000),
        blocked: result.stdout.includes('BLOCKED') || result.stdout.includes('branch-target-allowlist'),
        full_stdout: result.stdout,
      });

      // The guard should fire — output contains BLOCKED or the rule name.
      const blocked =
        result.stdout.includes('BLOCKED') ||
        result.stdout.includes('branch-target-allowlist') ||
        result.stdout.includes('blocked');
      expect(blocked).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 150_000);

  it('pi blocks git worktree add to /tmp/evil', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-smoke-wt2-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'smoke@test.com'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'smoke'], { cwd, stdio: 'ignore' });
      writeFileSync(join(cwd, 'README.md'), '# smoke\n');
      execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd, stdio: 'ignore' });

      const result = await runPiSession(
        'Run this exact bash command and report the result: git worktree add /tmp/evil-wt-smoke',
        cwd,
      );

      writeSmokeProof('worktree-evil', {
        timestamp: new Date().toISOString(),
        scenario: 'pi-smoke-worktree-evil',
        cwd,
        exitCode: result.exitCode,
        stdout_tail: result.stdout.slice(-2000),
        blocked: result.stdout.includes('BLOCKED') || result.stdout.includes('worktree-path-allowlist'),
        full_stdout: result.stdout,
      });

      const blocked =
        result.stdout.includes('BLOCKED') ||
        result.stdout.includes('worktree-path-allowlist') ||
        result.stdout.includes('blocked');
      expect(blocked).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 150_000);

  it('smoke proof files exist on disk', () => {
    // Verify proof files exist (only if smoke ran).
    if (!existsSync(join(smokeDir, 'checkout-non-allowed.jsonl'))) {
      console.log('smoke proofs not generated (smoke skipped)');
      return;
    }
    const proof = JSON.parse(
      readFileSync(join(smokeDir, 'checkout-non-allowed.jsonl'), 'utf8').trim(),
    );
    expect(proof.scenario).toBe('pi-smoke-checkout-non-allowed');
  });
});
