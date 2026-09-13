import { describe, expect, it } from 'bun:test';
import { unwrapWrapperTokens } from '../../../src/parser/unwrapWrapperProgram.ts';

describe('unwrapWrapperTokens — gotcha wrapper-unwrap', () => {
  it('sudo du -sh /var → program tokens start at du', () => {
    expect(unwrapWrapperTokens(['sudo', 'du', '-sh', '/var'])).toEqual(['du', '-sh', '/var']);
  });

  it('sudo -n du -xh -d1 / → skips flag -n (turn-1 incident command shape)', () => {
    expect(unwrapWrapperTokens(['sudo', '-n', 'du', '-xh', '-d1', '/'])).toEqual([
      'du',
      '-xh',
      '-d1',
      '/',
    ]);
  });

  it('sudo -u root du -sh / → value flag consumes "root"', () => {
    expect(unwrapWrapperTokens(['sudo', '-u', 'root', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('env FOO=1 du -sh / → skips VAR=value assignments', () => {
    expect(unwrapWrapperTokens(['env', 'FOO=1', 'BAR=2', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('env -u FOO du -sh / → -u consumes the var name', () => {
    expect(unwrapWrapperTokens(['env', '-u', 'FOO', 'du', '-sh', '/'])).toEqual(['du', '-sh', '/']);
  });

  it('nice -n 5 du -sh / → -n consumes the value', () => {
    expect(unwrapWrapperTokens(['nice', '-n', '5', 'du', '-sh', '/'])).toEqual(['du', '-sh', '/']);
  });

  it('timeout 30 du -sh / → duration positional skipped', () => {
    expect(unwrapWrapperTokens(['timeout', '30', 'du', '-sh', '/'])).toEqual(['du', '-sh', '/']);
  });

  it('timeout --signal=KILL 5s du -sh / → flags + duration skipped', () => {
    expect(unwrapWrapperTokens(['timeout', '--signal=KILL', '5s', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('nohup time du -sh / → stacked wrappers', () => {
    expect(unwrapWrapperTokens(['nohup', 'time', 'du', '-sh', '/'])).toEqual(['du', '-sh', '/']);
  });

  it('/usr/bin/sudo find / → absolute wrapper path still unwraps', () => {
    expect(unwrapWrapperTokens(['/usr/bin/sudo', 'find', '/'])).toEqual(['find', '/']);
  });

  it('du -sh /var → no wrapper, tokens unchanged', () => {
    expect(unwrapWrapperTokens(['du', '-sh', '/var'])).toEqual(['du', '-sh', '/var']);
  });

  it('env (alone) → unwrapping would consume everything; original kept', () => {
    expect(unwrapWrapperTokens(['env'])).toEqual(['env']);
    expect(unwrapWrapperTokens(['env', 'FOO=1'])).toEqual(['env', 'FOO=1']);
  });

  it('sudo (alone, no command) → original kept', () => {
    expect(unwrapWrapperTokens(['sudo', '-n'])).toEqual(['sudo', '-n']);
  });

  it('not-a-wrapper du -sh / → unchanged (unknown prefix is a program)', () => {
    expect(unwrapWrapperTokens(['zzz', 'du', '-sh', '/'])).toEqual(['zzz', 'du', '-sh', '/']);
  });

  it('env -C DIR du -sh / → -C consumes the chdir value (P1 regression)', () => {
    expect(unwrapWrapperTokens(['env', '-C', '/tmp', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('env --chdir=DIR du -sh / → --chdir consumed', () => {
    expect(unwrapWrapperTokens(['env', '--chdir=/tmp', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('timeout --preserve-status 5 du -sh / → boolean flag NOT value-taking (P1 regression)', () => {
    expect(unwrapWrapperTokens(['timeout', '--preserve-status', '5', 'du', '-sh', '/'])).toEqual([
      'du',
      '-sh',
      '/',
    ]);
  });

  it('ionice -t du -sh / → -t boolean NOT value-taking (P1 regression)', () => {
    expect(unwrapWrapperTokens(['ionice', '-t', 'du', '-sh', '/'])).toEqual(['du', '-sh', '/']);
  });
});
