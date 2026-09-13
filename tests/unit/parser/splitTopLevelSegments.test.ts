import { describe, expect, it } from 'bun:test';
import { splitTopLevelSegments } from '../../../src/parser/splitTopLevelSegments.ts';

describe('splitTopLevelSegments — top-level shell control operators', () => {
  it('single command → one segment unchanged', () => {
    expect(splitTopLevelSegments('git stash pop')).toEqual(['git stash pop']);
  });

  it('semicolon-separated commands split', () => {
    expect(splitTopLevelSegments('export FOO=bar; git stash pop')).toEqual([
      'export FOO=bar',
      'git stash pop',
    ]);
  });

  it('&& -separated commands split', () => {
    expect(splitTopLevelSegments('git checkout main && git stash pop')).toEqual([
      'git checkout main',
      'git stash pop',
    ]);
  });

  it('|| and | split', () => {
    expect(splitTopLevelSegments('a || b | c')).toEqual(['a', 'b', 'c']);
  });

  it('bash -c payload is split, trailing command preserved (P0 regression)', () => {
    expect(splitTopLevelSegments("bash -c 'x' && find /")).toEqual(['x', 'find /']);
  });

  it('bash -c payload with inner ; split, tail after && kept', () => {
    expect(splitTopLevelSegments("bash -c 'echo; find' && du -sh /var")).toEqual([
      'echo',
      'find',
      'du -sh /var',
    ]);
  });

  it('quoted ; inside bash -c is NOT cut at the inner ;', () => {
    // The payload itself contains `echo; find` which IS split (it is a real
    // compound payload), but a literal quoted string is one segment.
    expect(splitTopLevelSegments("bash -c 'echo hello; world'")).toEqual(['echo hello', 'world']);
  });

  it('redirect is NOT a segment boundary', () => {
    const segs = splitTopLevelSegments('echo hi > /tmp/x');
    expect(segs.length).toBe(1);
  });

  it('empty/whitespace → one segment', () => {
    expect(splitTopLevelSegments('   ')).toEqual(['']);
  });
});
