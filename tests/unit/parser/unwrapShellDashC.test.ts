import { describe, expect, it } from 'bun:test';
import { CommandParserCoordinator } from '../../../src/parser/CommandParser.ts';
import { programBasename, unwrapShellDashC } from '../../../src/parser/unwrapShellDashC.ts';

const parser = new CommandParserCoordinator();

describe('programBasename', () => {
  it('strips absolute path', () => {
    expect(programBasename('/usr/bin/find')).toBe('find');
  });
  it('lowercases bare names', () => {
    expect(programBasename('FIND')).toBe('find');
  });
});

describe('unwrapShellDashC', () => {
  it("unwraps bash -c 'find /home/bhd' (no inner semicolon)", () => {
    const parsed = parser.parse("bash -c 'find /home/bhd'");
    expect(parsed.program).toBe('bash');
    expect(unwrapShellDashC(parsed)).toBe('find /home/bhd');
  });

  it('unwraps bash -c inner compound (OT-bash-c)', () => {
    const parsed = parser.parse("bash -c 'echo hi; find /home/bhd -name goal.json -mmin -15'");
    expect(parsed.program).toBe('bash');
    expect(unwrapShellDashC(parsed)).toBe('echo hi; find /home/bhd -name goal.json -mmin -15');
  });

  it('unwraps /bin/bash -c', () => {
    const parsed = parser.parse("/bin/bash -c 'find /home/bhd'");
    expect(unwrapShellDashC(parsed)).toBe('find /home/bhd');
  });

  it('unwraps sh -c', () => {
    const parsed = parser.parse("sh -c 'grep -rl foo ~/.hermes'");
    expect(unwrapShellDashC(parsed)).toBe('grep -rl foo ~/.hermes');
  });

  it('unwraps bash -lc (combined short cluster containing c)', () => {
    const parsed = parser.parse("bash -lc 'find /home/bhd'");
    expect(unwrapShellDashC(parsed)).toBe('find /home/bhd');
  });

  it('unwraps bash --norc -c', () => {
    const parsed = parser.parse('bash --norc -c "find /home/bhd"');
    expect(unwrapShellDashC(parsed)).toBe('find /home/bhd');
  });

  it('returns null for find (not a shell -c)', () => {
    const parsed = parser.parse('find /home/bhd');
    expect(unwrapShellDashC(parsed)).toBeNull();
  });

  it('returns null for bash without -c', () => {
    const parsed = parser.parse('bash --version');
    expect(unwrapShellDashC(parsed)).toBeNull();
  });
});
