import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolveCdChange } from '../../../src/parser/cwdTracker.ts';

describe('cwdTracker (V4)', () => {
  const home = process.env.HOME ?? homedir();

  it('detects simple cd to absolute existing path', () => {
    const res = resolveCdChange('cd /tmp', '/home', [], '/home');
    expect(res).toEqual({
      type: 'success',
      newCwd: '/tmp',
      lastCwd: '/home',
    });
  });

  it('detects cd to ~ (home)', () => {
    const res = resolveCdChange('cd ~', '/tmp', [], '/tmp');
    expect(res).toEqual({
      type: 'success',
      newCwd: home,
      lastCwd: '/tmp',
    });
  });

  it('detects cd with no arguments (home)', () => {
    const res = resolveCdChange('cd', '/tmp', [], '/tmp');
    expect(res).toEqual({
      type: 'success',
      newCwd: home,
      lastCwd: '/tmp',
    });
  });

  it('detects cd - (lastCwd)', () => {
    const res = resolveCdChange('cd -', '/tmp', [], '/var');
    expect(res).toEqual({
      type: 'success',
      newCwd: '/var',
      lastCwd: '/tmp',
    });
  });

  it('handles pushd and popd stack', () => {
    const stack: string[] = [];
    const pushRes = resolveCdChange('pushd /tmp', '/home', stack, '/home');
    expect(pushRes).toEqual({
      type: 'success',
      newCwd: '/tmp',
      lastCwd: '/home',
    });
    expect(stack).toEqual(['/home']);

    const popRes = resolveCdChange('popd', '/tmp', stack, '/tmp');
    expect(popRes).toEqual({
      type: 'success',
      newCwd: '/home',
      lastCwd: '/tmp',
    });
    expect(stack).toEqual([]);
  });

  it('returns unresolvable for non-existent directory', () => {
    const res = resolveCdChange(
      'cd /path/that/definitely/does/not/exist/12345',
      '/tmp',
      [],
      '/tmp',
    );
    expect(res.type).toBe('unresolvable');
    if (res.type === 'unresolvable') {
      expect(res.reason).toContain('directory does not exist');
    }
  });

  it('returns not-cd for other commands', () => {
    const res = resolveCdChange('git status', '/tmp', [], '/tmp');
    expect(res).toEqual({ type: 'not-cd' });
  });

  it('handles env assignments before cd: FOO=bar cd /tmp', () => {
    const res = resolveCdChange('FOO=bar cd /tmp', '/home', [], '/home');
    expect(res).toEqual({
      type: 'success',
      newCwd: '/tmp',
      lastCwd: '/home',
    });
  });
});
