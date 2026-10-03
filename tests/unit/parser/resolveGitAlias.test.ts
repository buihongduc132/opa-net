import { describe, expect, it } from 'bun:test';
import { resolveGitAlias } from '../../../src/parser/resolveGitAlias.ts';
import type { ParsedCommand } from '../../../src/parser/types.ts';

describe('resolveGitAlias (V2)', () => {
  it('resolves simple one-shot alias from gitConfigs', () => {
    const parsed: ParsedCommand = {
      raw: 'git co feature-evil',
      program: 'git',
      subcommand: 'co',
      args: ['feature-evil'],
      parseConfidence: 'full',
    };
    const configs = [{ key: 'alias.co', value: 'checkout' }];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.parsed.subcommand).toBe('checkout');
    expect(res.parsed.args).toEqual(['feature-evil']);
    expect(res.isShellAlias).toBeUndefined();
  });

  it('resolves multi-word alias prepending extra args', () => {
    const parsed: ParsedCommand = {
      raw: 'git br evil',
      program: 'git',
      subcommand: 'br',
      args: ['evil'],
      parseConfidence: 'full',
    };
    const configs = [{ key: 'alias.br', value: 'branch -m' }];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.parsed.subcommand).toBe('branch');
    expect(res.parsed.args).toEqual(['-m', 'evil']);
  });

  it('detects shell alias starting with !', () => {
    const parsed: ParsedCommand = {
      raw: 'git sh evil',
      program: 'git',
      subcommand: 'sh',
      args: ['evil'],
      parseConfidence: 'full',
    };
    const configs = [{ key: 'alias.sh', value: '!bash evil.sh' }];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.isShellAlias).toBe(true);
  });

  it('resolves chained aliases', () => {
    const parsed: ParsedCommand = {
      raw: 'git a test',
      program: 'git',
      subcommand: 'a',
      args: ['test'],
      parseConfidence: 'full',
    };
    const configs = [
      { key: 'alias.a', value: 'b' },
      { key: 'alias.b', value: 'status' },
    ];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.parsed.subcommand).toBe('status');
    expect(res.parsed.args).toEqual(['test']);
  });

  it('breaks cycles without infinite loop', () => {
    const parsed: ParsedCommand = {
      raw: 'git a test',
      program: 'git',
      subcommand: 'a',
      args: ['test'],
      parseConfidence: 'full',
    };
    const configs = [
      { key: 'alias.a', value: 'b' },
      { key: 'alias.b', value: 'a' },
    ];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.parsed.subcommand).toBe('a');
  });

  it('ignores non-git programs', () => {
    const parsed: ParsedCommand = {
      raw: 'npm run test',
      program: 'npm',
      subcommand: 'run',
      args: ['test'],
      parseConfidence: 'full',
    };
    const configs = [{ key: 'alias.run', value: 'start' }];
    const res = resolveGitAlias(parsed, '/tmp', configs);
    expect(res.parsed).toBe(parsed);
  });
});
