import { describe, expect, it } from 'bun:test';
import { EnvSignals } from '../../../src/signals/EnvSignals.ts';
import { RepoSignals } from '../../../src/signals/RepoSignals.ts';
import { WorktreeSignals, parseWorktreePath } from '../../../src/signals/WorktreeSignals.ts';
import { collectAll } from '../../../src/signals/collectAll.ts';
import type { ParsedCommand } from '../../../src/parser/types.ts';

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
