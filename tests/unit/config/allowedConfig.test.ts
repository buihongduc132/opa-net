import { describe, expect, it } from 'bun:test';
import { parseAllowedBranches, parseWorktreeAllowedDirs } from '../../../src/config/Config.ts';

describe('parseAllowedBranches', () => {
  it('returns default when env is undefined', () => {
    expect(parseAllowedBranches(undefined)).toEqual(['dev', 'staging', 'main', 'master']);
  });

  it('returns empty array for empty string', () => {
    expect(parseAllowedBranches('')).toEqual([]);
  });

  it('parses comma-separated values', () => {
    expect(parseAllowedBranches('trunk,develop')).toEqual(['trunk', 'develop']);
  });

  it('trims whitespace', () => {
    expect(parseAllowedBranches(' dev , staging ')).toEqual(['dev', 'staging']);
  });

  it('filters empty entries from trailing comma', () => {
    expect(parseAllowedBranches('dev,staging,main,')).toEqual(['dev', 'staging', 'main']);
  });

  it('filters empty entries from multiple commas', () => {
    expect(parseAllowedBranches('dev,,staging')).toEqual(['dev', 'staging']);
  });
});

describe('parseWorktreeAllowedDirs', () => {
  it('returns default when env is undefined', () => {
    const result = parseWorktreeAllowedDirs(undefined);
    expect(result).toContain('.worktrees');
    expect(result).toContain('worktrees');
    expect(result.length).toBe(3);
  });

  it('returns empty array for empty string', () => {
    expect(parseWorktreeAllowedDirs('')).toEqual([]);
  });

  it('parses comma-separated values', () => {
    expect(parseWorktreeAllowedDirs('/opt/wt,/tmp/safe')).toEqual(['/opt/wt', '/tmp/safe']);
  });

  it('trims whitespace', () => {
    expect(parseWorktreeAllowedDirs(' /opt/wt , /tmp/safe ')).toEqual(['/opt/wt', '/tmp/safe']);
  });

  it('filters empty entries from trailing comma', () => {
    expect(parseWorktreeAllowedDirs('/opt/wt,/tmp/safe,')).toEqual(['/opt/wt', '/tmp/safe']);
  });

  it('expands ~ to HOME', () => {
    const home = process.env.HOME ?? '';
    const result = parseWorktreeAllowedDirs('~/worktrees');
    expect(result[0]).toBe(`${home}/worktrees`);
  });
});
