import { describe, expect, it } from 'bun:test';
import { execSync as nodeExecSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedCommand } from '../../../src/parser/types.ts';
import { EnvSignals } from '../../../src/signals/EnvSignals.ts';
import { RepoSignals } from '../../../src/signals/RepoSignals.ts';
import { WorktreeSignals, parseWorktreePath } from '../../../src/signals/WorktreeSignals.ts';
import { collectAll } from '../../../src/signals/collectAll.ts';

const execSyncRaw = ((cmd: string, opts?: any) =>
  nodeExecSync(cmd, {
    ...opts,
    env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin', ...(opts?.env ?? {}) },
  })) as typeof nodeExecSync;

const makeParsed = (program: string, subcommand: string, args: string[] = []): ParsedCommand => ({
  raw: `${program} ${subcommand} ${args.join(' ')}`.trim(),
  program,
  subcommand,
  args,
  parseConfidence: 'full',
});

const makeCtx = (program: string, subcommand: string, args: string[] = [], cwd = '/tmp') => ({
  cwd,
  raw: `${program} ${subcommand} ${args.join(' ')}`.trim(),
  parsed: makeParsed(program, subcommand, args),
});

describe('EnvSignals', () => {
  it('collects home directory', () => {
    const collector = new EnvSignals();
    const result = collector.collect(makeCtx('docker', 'run'));
    expect(result.available).toBe(true);
    expect(result.home).toBeTruthy();
    expect(result.cwd).toBe('/tmp');
  });
});

describe('RepoSignals', () => {
  it('returns unavailable for non-git commands', () => {
    const collector = new RepoSignals();
    const result = collector.collect(makeCtx('docker', 'run'));
    expect(result.available).toBe(false);
  });

  it('returns unavailable for non-repo cwd', () => {
    const collector = new RepoSignals();
    const result = collector.collect(makeCtx('git', 'status', [], '/tmp/nonexistent-repo'));
    expect(result.available).toBe(false);
  });

  it('detects standalone sibling clones: shortest name is main', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'repo-signals-siblings-'));
    const mainDir = join(tmp, 'app-config');
    const wtDir = join(tmp, 'app-config-wt');
    mkdirSync(mainDir);
    mkdirSync(wtDir);
    execSyncRaw('git init -b main', { cwd: mainDir, stdio: 'ignore' });
    execSyncRaw('git init -b main', { cwd: wtDir, stdio: 'ignore' });

    try {
      const collector = new RepoSignals();
      const mainResult = collector.collect(makeCtx('git', 'status', [], mainDir));
      expect(mainResult.available).toBe(true);
      expect(mainResult.is_main_worktree).toBe(true);
      expect(mainResult.protected).toBe(true);

      const wtResult = collector.collect(makeCtx('git', 'status', [], wtDir));
      expect(wtResult.available).toBe(true);
      expect(wtResult.is_main_worktree).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('faked-clock boundary tests: 2d23h is protected, 3d1h is not protected (R2)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'repo-signals-clock-'));
    const mainDir = join(tmp, 'my-repo');
    const wtDir = join(tmp, 'my-repo-wt');
    mkdirSync(mainDir);
    mkdirSync(wtDir);
    execSyncRaw('git init -b main', { cwd: mainDir, stdio: 'ignore' });
    execSyncRaw('git init -b main', { cwd: wtDir, stdio: 'ignore' });

    const t0 = 1700000000000;
    const fs = require('node:fs') as typeof import('node:fs');
    fs.utimesSync(wtDir, new Date(t0), new Date(t0));

    try {
      // 2 days 23 hours later: 2 * 86400 + 23 * 3600 = 255600 seconds
      const clock2d23h = () => t0 + (2 * 24 + 23) * 3600 * 1000;
      const collectorYoung = new RepoSignals({ now: clock2d23h });
      const youngRes = collectorYoung.collect(makeCtx('git', 'status', [], wtDir));
      expect(youngRes.is_main_worktree).toBe(false);
      expect(youngRes.protected).toBe(true);
      expect(youngRes.age_days).toBeLessThan(3);

      // 3 days 1 hour later: 3 * 86400 + 1 * 3600 = 262800 seconds
      const clock3d1h = () => t0 + (3 * 24 + 1) * 3600 * 1000;
      const collectorOld = new RepoSignals({ now: clock3d1h });
      const oldRes = collectorOld.collect(makeCtx('git', 'status', [], wtDir));
      expect(oldRes.is_main_worktree).toBe(false);
      expect(oldRes.protected).toBe(false);
      expect(oldRes.age_days).toBeGreaterThan(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reads age from linked worktree logs/HEAD reflog', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'repo-signals-linked-'));
    const mainDir = join(tmp, 'repo');
    mkdirSync(mainDir);
    execSyncRaw('git init -b main', { cwd: mainDir, stdio: 'ignore' });
    execSyncRaw('git config user.email test@test.com', { cwd: mainDir, stdio: 'ignore' });
    execSyncRaw('git config user.name test', { cwd: mainDir, stdio: 'ignore' });
    writeFileSync(join(mainDir, 'file.txt'), 'init');
    execSyncRaw(
      'git -c core.hooksPath=/dev/null add file.txt && git -c core.hooksPath=/dev/null commit -m init',
      { cwd: mainDir, stdio: 'ignore' },
    );

    const wtDir = join(tmp, 'repo-wt');
    execSyncRaw(`git worktree add ${wtDir} -b wt-branch`, { cwd: mainDir, stdio: 'ignore' });

    try {
      const collector = new RepoSignals();
      const wtRes = collector.collect(makeCtx('git', 'status', [], wtDir));
      expect(wtRes.available).toBe(true);
      expect(wtRes.is_main_worktree).toBe(false);
      expect(wtRes.protected).toBe(true);
      expect(wtRes.age_days).toBeLessThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('honors PIOPANET_PROTECT_DAYS override', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'repo-signals-knob-'));
    const mainDir = join(tmp, 'repo');
    const wtDir = join(tmp, 'repo-wt');
    mkdirSync(mainDir);
    mkdirSync(wtDir);
    execSyncRaw('git init -b main', { cwd: mainDir, stdio: 'ignore' });
    execSyncRaw('git init -b main', { cwd: wtDir, stdio: 'ignore' });

    const t0 = 1700000000000;
    const fs = require('node:fs') as typeof import('node:fs');
    fs.utimesSync(wtDir, new Date(t0), new Date(t0));

    const clock2d = () => t0 + 2 * 86400 * 1000;
    const prevEnv = process.env.PIOPANET_PROTECT_DAYS;
    try {
      delete process.env.PIOPANET_PROTECT_DAYS;
      const cDefault = new RepoSignals({ now: clock2d });
      expect(cDefault.collect(makeCtx('git', 'status', [], wtDir)).protected).toBe(true);

      process.env.PIOPANET_PROTECT_DAYS = '1';
      const c1Day = new RepoSignals({ now: clock2d });
      expect(c1Day.collect(makeCtx('git', 'status', [], wtDir)).protected).toBe(false);

      // OT-7: options.protectDays takes precedence over env var
      const cExplicit = new RepoSignals({ now: clock2d, protectDays: 5 });
      expect(cExplicit.collect(makeCtx('git', 'status', [], wtDir)).protected).toBe(true);
    } finally {
      if (prevEnv !== undefined) process.env.PIOPANET_PROTECT_DAYS = prevEnv;
      else delete process.env.PIOPANET_PROTECT_DAYS;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('WorktreeSignals', () => {
  it('returns unavailable for non-git commands', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(makeCtx('docker', 'run'));
    expect(result.available).toBe(false);
    expect(result.target_path).toBeNull();
  });

  it('returns unavailable for git status', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(makeCtx('git', 'status'));
    expect(result.available).toBe(false);
  });

  it('extracts path from git worktree add', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(makeCtx('git', 'worktree', ['add', '.worktrees/feat']));
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('.worktrees/feat');
    expect(result.worktree_subcommand).toBe('add');
  });

  it('extracts path from git worktree add with -b flag', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(
      makeCtx('git', 'worktree', ['add', '-b', 'feature', '.worktrees/feat']),
    );
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('.worktrees/feat');
  });

  it('add with commit-ish: path-first form `.worktrees/feat HEAD` → path, not ref', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(
      makeCtx('git', 'worktree', ['add', '.worktrees/feat', 'HEAD']),
    );
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('.worktrees/feat');
  });

  it('add old-style form `HEAD ../feat` → picks path-like positional', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(makeCtx('git', 'worktree', ['add', 'HEAD', '../feat']));
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('../feat');
  });

  it('add with refs/ ref first → path is last (`refs/heads/feat ../wt`)', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(
      makeCtx('git', 'worktree', ['add', 'refs/heads/feat', '../wt']),
    );
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('../wt');
  });

  it('add with sha commit-ish first → path is last', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(
      makeCtx('git', 'worktree', ['add', 'a1b2c3d', '.worktrees/wt']),
    );
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('.worktrees/wt');
  });

  it('extracts new-path from git worktree move', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(
      makeCtx('git', 'worktree', ['move', '.worktrees/feat', '/tmp/evil']),
    );
    expect(result.available).toBe(true);
    expect(result.target_path).toBe('/tmp/evil');
  });

  it('returns unavailable for git worktree list', () => {
    const collector = new WorktreeSignals();
    const result = collector.collect(makeCtx('git', 'worktree', ['list']));
    expect(result.available).toBe(false);
  });
});

describe('parseWorktreePath', () => {
  it('extracts path from add args', () => {
    expect(parseWorktreePath(['add', '.worktrees/feat'])).toBe('.worktrees/feat');
  });

  it('skips -b flag and value', () => {
    expect(parseWorktreePath(['-b', 'feature', '.worktrees/feat'])).toBe('.worktrees/feat');
  });

  it('handles -- separator', () => {
    expect(parseWorktreePath(['--', '.worktrees/feat'])).toBe('.worktrees/feat');
  });

  it('returns null for no positionals', () => {
    expect(parseWorktreePath(['-f', '--detach'])).toBeNull();
  });

  it('handles -b=val form', () => {
    expect(parseWorktreePath(['-bfeature', '.worktrees/feat'])).toBe('.worktrees/feat');
  });
});

describe('collectAll', () => {
  it('merges signals from all collectors', () => {
    const collectors = [new EnvSignals()];
    const result = collectAll(collectors, makeCtx('docker', 'run'));
    expect(result.env).toBeDefined();
  });

  it('handles collector errors gracefully', () => {
    const broken = {
      name: 'broken',
      collect: () => {
        throw new Error('boom');
      },
    };
    const result = collectAll([broken], makeCtx('git', 'status'));
    expect(result.broken).toEqual({ available: false });
  });
});
