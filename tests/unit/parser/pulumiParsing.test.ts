import { describe, expect, it } from 'bun:test';
import { CommandParserCoordinator } from '../../../src/parser/CommandParser.ts';

/**
 * GROUP I — pulumi parsing.
 * pulumi is a subcommand-style program: `pulumi up --force` must parse to
 * subcommand="up" so the rego GROUP I rules (block-pulumi-up-force, etc.)
 * can match. If pulumi is dropped from SUBCOMMAND_PROGRAMS, all GROUP I
 * rules silently stop firing — this test is the canary.
 */
const parser = new CommandParserCoordinator();

describe('pulumi subcommand parsing (GROUP I canary)', () => {
  it('pulumi up --force → subcommand=up, args=[--force]', () => {
    const r = parser.parse('pulumi up --force');
    expect(r.program).toBe('pulumi');
    expect(r.subcommand).toBe('up');
    expect(r.args).toEqual(['--force']);
  });

  it('pulumi destroy → subcommand=destroy', () => {
    const r = parser.parse('pulumi destroy');
    expect(r.subcommand).toBe('destroy');
    expect(r.args).toEqual([]);
  });

  it('pulumi stack rm prod → subcommand=stack, args=[rm, prod]', () => {
    const r = parser.parse('pulumi stack rm prod');
    expect(r.subcommand).toBe('stack');
    expect(r.args).toEqual(['rm', 'prod']);
  });

  it('pulumi state delete urn → subcommand=state, args=[delete, urn]', () => {
    const r = parser.parse('pulumi state delete urn:foo');
    expect(r.subcommand).toBe('state');
    expect(r.args).toEqual(['delete', 'urn:foo']);
  });

  it('bare pulumi → empty subcommand', () => {
    const r = parser.parse('pulumi');
    expect(r.program).toBe('pulumi');
    expect(r.subcommand).toBe('');
  });
});
