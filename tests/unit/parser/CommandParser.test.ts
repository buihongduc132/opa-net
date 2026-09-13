import { describe, expect, it } from 'bun:test';
import { CommandParserCoordinator } from '../../../src/parser/CommandParser.ts';
import { RegexFallbackParser } from '../../../src/parser/RegexFallbackParser.ts';
import { ShellQuoteParser } from '../../../src/parser/ShellQuoteParser.ts';
import type { CommandParser } from '../../../src/parser/types.ts';

describe('ShellQuoteParser', () => {
  const p = new ShellQuoteParser();

  it('parses program + subcommand + args with full confidence', () => {
    const r = p.parse('git stash pop');
    expect(r).toEqual({
      raw: 'git stash pop',
      program: 'git',
      subcommand: 'stash',
      args: ['pop'],
      parseConfidence: 'full',
    });
  });

  it('carve-out keeps list allow path', () => {
    const r = p.parse('git stash list');
    expect(r.subcommand).toBe('stash');
    expect(r.args).toEqual(['list']);
    expect(r.parseConfidence).toBe('full');
  });

  it('bare git stash → empty subcommand (OT3 native handling)', () => {
    const r = p.parse('git stash');
    expect(r.program).toBe('git');
    expect(r.subcommand).toBe('stash');
    expect(r.args).toEqual([]);
  });

  it('lowercases program and subcommand', () => {
    const r = p.parse('DOCKER STOP foo');
    expect(r.program).toBe('docker');
    expect(r.subcommand).toBe('stop');
    expect(r.args).toEqual(['foo']);
  });

  it('subcommand-style programs: tokens[1] = subcommand', () => {
    const r = p.parse('git stash pop');
    expect(r.subcommand).toBe('stash');
    expect(r.args).toEqual(['pop']);
  });

  it('non-subcommand programs: everything after program is args', () => {
    const rm = p.parse('rm bd-workflow');
    expect(rm.program).toBe('rm');
    expect(rm.subcommand).toBe('');
    expect(rm.args).toEqual(['bd-workflow']);

    const bd = p.parse('bd --notes');
    expect(bd.program).toBe('bd');
    expect(bd.subcommand).toBe('');
    expect(bd.args).toEqual(['--notes']);
  });

  it('subcommand-style program with flag as token[1]: flag goes to args (non-global)', () => {
    const r = p.parse('git --no-such-flag');
    expect(r.program).toBe('git');
    expect(r.subcommand).toBe('');
    expect(r.args).toEqual(['--no-such-flag']);
  });

  it('LD8: strips git global options before subcommand classification', () => {
    const r = p.parse('git -C /evil worktree add foo');
    expect(r.program).toBe('git');
    expect(r.subcommand).toBe('worktree');
    expect(r.args).toEqual(['add', 'foo']);
  });

  it('LD8: strips --version global option', () => {
    const r = p.parse('git --version');
    expect(r.program).toBe('git');
    expect(r.subcommand).toBe('');
    expect(r.args).toEqual([]); // --version is stripped as a global option
  });

  it('reports partial confidence on redirects', () => {
    const r = p.parse('git log > out.txt');
    expect(r.parseConfidence).toBe('partial');
    expect(r.program).toBe('git');
  });

  it('reports partial on pipelines', () => {
    const r = p.parse('ls | grep foo');
    expect(r.parseConfidence).toBe('partial');
  });

  it('reports failed on empty string', () => {
    expect(p.parse('').parseConfidence).toBe('failed');
    expect(p.parse('   ').parseConfidence).toBe('failed');
  });

  it('shell-quote is lenient on unclosed quotes (still full)', () => {
    // shell-quote does not throw on unclosed quotes — it tokenizes leniently.
    // Confidence stays full; the leniency is a known property of the AST path.
    const r = p.parse("git commit -m 'unclosed");
    expect(r.parseConfidence).toBe('full');
    expect(r.args).toContain('-m');
  });
});

describe('RegexFallbackParser', () => {
  const p = new RegexFallbackParser();

  it('splits on whitespace, lowercases, regex-only confidence', () => {
    const r = p.parse('GIT Stash POP');
    expect(r).toEqual({
      raw: 'GIT Stash POP',
      program: 'git',
      subcommand: 'stash',
      args: ['pop'],
      parseConfidence: 'regex-only',
    });
  });

  it('handles single token', () => {
    const r = p.parse('ls');
    expect(r.program).toBe('ls');
    expect(r.subcommand).toBe('');
    expect(r.args).toEqual([]);
  });

  it('collapses internal whitespace', () => {
    const r = p.parse('git    stash     list');
    expect(r.args).toEqual(['list']);
  });

  it('failed on empty', () => {
    expect(p.parse('   ').parseConfidence).toBe('failed');
  });
});

describe('CommandParserCoordinator (hybrid)', () => {
  const c = new CommandParserCoordinator();

  it('uses AST primary for clean input', () => {
    expect(c.parse('git stash pop').parseConfidence).toBe('full');
  });

  it('falls back to regex when primary reports failed (injected)', () => {
    // Inject a primary that always fails → coordinator must use fallback.
    const failingPrimary: CommandParser = {
      name: 'fail',
      parse: () => ({
        raw: '',
        program: '',
        subcommand: '',
        args: [],
        parseConfidence: 'failed' as const,
      }),
    };
    const coord = new CommandParserCoordinator(failingPrimary);
    const r = coord.parse('git stash pop');
    expect(r.parseConfidence).toBe('regex-only');
    expect(r.program).toBe('git');
  });

  it('passes through partial confidence from AST (no fallback)', () => {
    const r = c.parse('git log > out');
    expect(r.parseConfidence).toBe('partial');
  });

  it('name is hybrid', () => {
    expect(c.name).toBe('hybrid');
  });
});
