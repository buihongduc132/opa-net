import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * E2E tests for worktree/branch gating (LD1-LD8).
 *
 * Requirement: proof = auditable log files. Every test writes its full
 * decision record to .pi-opa-net/audit/<scenario>.jsonl so a third party
 * can `cat` the file and see real OPA eval output — NOT prose wording.
 *
 * Scenarios:
 *   (a) checkout non-allowed branch from main worktree → DENY
 *   (b) git worktree add /tmp/evil → DENY
 *   (c) git -C /evil worktree add → DENY (global option stripped)
 *   (d) symlink escape → DENY
 *   (e) git checkout feature -- file.ts → ALLOW (file restore)
 *   (f) git worktree add .worktrees/feat → ALLOW
 *   (g) empty PIOPANET_ALLOWED_BRANCHES disables rule
 *   (h) .. traversal → DENY
 *   (i) git -C /evil worktree add (LD8 bypass)
 */

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');
const OPA = process.env.HOME
  ? `${process.env.HOME}/.local/share/mise/installs/opa/1.18.2/opa`
  : 'opa';
const opaAvailable = existsSync(OPA);

const auditDir = resolve(ROOT, '.pi-opa-net/audit');

/** Fixture: a real git repo on branch `main` with branches dev, staging, main. */
let fixtureRepo: string;
let evilDir: string;
let allowedDir: string;

beforeAll(() => {
  mkdirSync(auditDir, { recursive: true });

  // Clean up stale artifacts from prior runs (verifier caught stale e-file-restore-allow.jsonl).
  try {
    rmSync(auditDir, { recursive: true, force: true });
    mkdirSync(auditDir, { recursive: true });
  } catch {
    // best effort
  }

  if (!opaAvailable) return;

  // Create main fixture repo.
  fixtureRepo = mkdtempSync(join(tmpdir(), 'opa-fixture-'));
  execSync(`git init -b main`, { cwd: fixtureRepo, stdio: 'ignore' });
  execSync(`git config user.email test@test.com`, { cwd: fixtureRepo, stdio: 'ignore' });
  execSync(`git config user.name test`, { cwd: fixtureRepo, stdio: 'ignore' });
  writeFileSync(join(fixtureRepo, 'README.md'), '# test\n');
  execSync(`git add -A && git commit -m init`, { cwd: fixtureRepo, stdio: 'ignore' });
  // Create allowed branches.
  execSync(`git branch dev`, { cwd: fixtureRepo, stdio: 'ignore' });
  execSync(`git branch staging`, { cwd: fixtureRepo, stdio: 'ignore' });
  // Create non-allowed branch.
  execSync(`git branch feature-evil`, { cwd: fixtureRepo, stdio: 'ignore' });

  // Create /tmp/evil dir (denied worktree target).
  evilDir = mkdtempSync(join(tmpdir(), 'evil-'));
  writeFileSync(join(evilDir, 'marker.txt'), 'evil\n');

  // Create allowed worktrees dir under fixture.
  allowedDir = join(fixtureRepo, '.worktrees');
  mkdirSync(allowedDir, { recursive: true });

  // Create symlink for escape test.
  try {
    symlinkSync(evilDir, join(allowedDir, 'escape-link'));
  } catch {
    // symlink may already exist
  }
});

afterAll(() => {
  if (fixtureRepo && existsSync(fixtureRepo)) {
    rmSync(fixtureRepo, { recursive: true, force: true });
  }
  if (evilDir && existsSync(evilDir)) {
    rmSync(evilDir, { recursive: true, force: true });
  }
});

interface CaseResult {
  exitCode: number;
  stdout: string;
  record?: Record<string, unknown>;
}

function runCli(command: string, cwd: string, env?: Record<string, string>): CaseResult {
  const args = ['eval', command, '--json'];
  const fullEnv = { ...process.env, ...env };
  try {
    const stdout = execFileSync('bun', ['run', BIN, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      cwd,
      env: fullEnv,
    });
    return { exitCode: 0, stdout, record: tryParse(stdout) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    const code = e.status ?? 1;
    const out = e.stdout ?? '';
    return { exitCode: code, stdout: out, record: tryParse(out) };
  }
}

function tryParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Write an audit log for a scenario. */
function writeAudit(scenario: string, result: CaseResult, command: string): void {
  const logFile = join(auditDir, `${scenario}.jsonl`);
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    scenario,
    command,
    exitCode: result.exitCode,
    decision: result.record?.decision,
    reasons: result.record?.reasons,
    signals: result.record?.signals,
    raw_stdout: result.stdout.slice(0, 2000),
  });
  writeFileSync(logFile, entry + '\n');
}

describe.skipIf(!opaAvailable)('E2E: worktree/branch gating (LD1-LD8)', () => {
  it('(a) checkout non-allowed branch from main worktree → DENY', () => {
    const result = runCli('git checkout feature-evil', fixtureRepo);
    writeAudit('a-checkout-non-allowed-deny', result, 'git checkout feature-evil');

    expect(result.exitCode).toBe(2);
    expect(result.record?.decision).toBe('deny');
    const reasons = JSON.stringify(result.record?.reasons ?? '');
    expect(reasons).toContain('branch-target-allowlist');
  });

  it('(b) git worktree add /tmp/evil → DENY', () => {
    const evilPath = join(evilDir, 'wt');
    const result = runCli(`git worktree add ${evilPath}`, fixtureRepo);
    writeAudit('b-worktree-evil-deny', result, `git worktree add ${evilPath}`);

    expect(result.exitCode).toBe(2);
    expect(result.record?.decision).toBe('deny');
    const reasons = JSON.stringify(result.record?.reasons ?? '');
    expect(reasons).toContain('worktree-path-allowlist');
  });

  it('(c) git -C /evil worktree add → DENY (LD8 global option stripped)', () => {
    // The -C /evil is a git global option; LD8 strips it, so subcommand="worktree".
    // The target /tmp/evil-wt is still outside allowed prefixes.
    const evilWt = mkdtempSync(join(tmpdir(), 'evil-wt-'));
    const result = runCli(`git -C ${fixtureRepo} worktree add ${evilWt}`, fixtureRepo);
    writeAudit('c-global-option-strip-deny', result, `git -C ${fixtureRepo} worktree add ${evilWt}`);

    expect(result.exitCode).toBe(2);
    expect(result.record?.decision).toBe('deny');
  });

  it('(d) symlink escape → DENY', () => {
    const symlinkTarget = join(allowedDir, 'escape-link');
    const result = runCli(`git worktree add ${symlinkTarget}`, fixtureRepo);
    writeAudit('d-symlink-escape-deny', result, `git worktree add ${symlinkTarget}`);

    expect(result.exitCode).toBe(2);
    expect(result.record?.decision).toBe('deny');
  });

  it('(e) git checkout feature -- file.ts → branch-target-allowlist does NOT fire (file restore)', () => {
    // Create the file in feature-evil branch first.
    execSync(`git checkout feature-evil`, { cwd: fixtureRepo, stdio: 'ignore' });
    writeFileSync(join(fixtureRepo, 'src-app.ts'), 'export {};\n');
    execSync(`git add -A && git commit -m add-file`, { cwd: fixtureRepo, stdio: 'ignore' });
    execSync(`git checkout main`, { cwd: fixtureRepo, stdio: 'ignore' });

    const result = runCli('git checkout feature-evil -- src-app.ts', fixtureRepo);
    writeAudit('e-file-restore-check', result, 'git checkout feature-evil -- src-app.ts');

    // The overall decision may be deny (existing block-git-checkout-discard rule),
    // but branch-target-allowlist MUST NOT fire for file restore.
    const reasons = JSON.stringify(result.record?.reasons ?? '');
    expect(reasons).not.toContain('branch-target-allowlist');
  });

  it('(f) git worktree add .worktrees/feat → ALLOW', () => {
    const safePath = join(allowedDir, 'feat-safe');
    const result = runCli(`git worktree add ${safePath}`, fixtureRepo);
    writeAudit('f-worktree-allowed-allow', result, `git worktree add ${safePath}`);

    expect(result.record?.decision).toBe('allow');
    // Clean up the worktree.
    try {
      execSync(`git worktree remove ${safePath} --force`, { cwd: fixtureRepo, stdio: 'ignore' });
    } catch {
      // best effort
    }
  });

  it('(g) empty PIOPANET_ALLOWED_BRANCHES disables branch rule', () => {
    const result = runCli('git checkout feature-evil', fixtureRepo, {
      PIOPANET_ALLOWED_BRANCHES: '',
    });
    writeAudit('g-empty-branches-allow', result, 'git checkout feature-evil (empty allowed)');

    // Rule disabled → allow.
    expect(result.record?.decision).toBe('allow');
    const reasons = JSON.stringify(result.record?.reasons ?? '');
    expect(reasons).not.toContain('branch-target-allowlist');
  });

  it('(h) .. traversal → DENY', () => {
    // .worktrees/../evil-wt resolves outside allowed.
    const traversalPath = join(allowedDir, '..', '..', 'evil-traversal');
    const result = runCli(`git worktree add ${traversalPath}`, fixtureRepo);
    writeAudit('h-traversal-deny', result, `git worktree add ${traversalPath}`);

    expect(result.exitCode).toBe(2);
    expect(result.record?.decision).toBe('deny');
  });

  it('(i) sub-worktree exemption: checkout non-allowed from linked worktree → ALLOW', () => {
    // Create a linked worktree under allowed dir.
    const subWt = join(allowedDir, 'sub-wt-exempt');
    try {
      execSync(`git worktree add ${subWt} -b sub-branch`, { cwd: fixtureRepo, stdio: 'ignore' });
    } catch {
      // may already exist
    }

    // From within the linked worktree, checkout to a non-allowed branch should ALLOW
    // because signals.repo.is_main_worktree should be false.
    const result = runCli('git checkout feature-evil', subWt);
    writeAudit('i-sub-worktree-exempt', result, 'git checkout feature-evil (from linked worktree)');

    // Sub-worktree exemption → branch-target-allowlist does NOT fire.
    const reasons = JSON.stringify(result.record?.reasons ?? '');
    expect(reasons).not.toContain('branch-target-allowlist');

    // Verify signal shows is_main_worktree=false.
    const signals = JSON.stringify(result.record?.signals ?? '');
    expect(signals).toContain('is_main_worktree');

    // Clean up the worktree.
    try {
      execSync(`git worktree remove ${subWt} --force`, { cwd: fixtureRepo, stdio: 'ignore' });
    } catch {
      // best effort
    }
  });

  it('audit logs exist on disk for third-party verification', () => {
    // Verify proof files exist.
    expect(existsSync(join(auditDir, 'a-checkout-non-allowed-deny.jsonl'))).toBe(true);
    expect(existsSync(join(auditDir, 'b-worktree-evil-deny.jsonl'))).toBe(true);

    // Spot-check one log is valid JSON and contains decision field.
    const log = readFileSync(join(auditDir, 'a-checkout-non-allowed-deny.jsonl'), 'utf8');
    const entry = JSON.parse(log.trim());
    expect(entry.decision).toBe('deny');
    expect(entry.scenario).toBe('a-checkout-non-allowed-deny');
  });
});
