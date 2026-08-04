import { describe, expect, it } from 'bun:test';
import { stripGitGlobalOptions } from '../../../src/parser/stripGitGlobalOptions.ts';

describe('stripGitGlobalOptions', () => {
  describe('value-consuming globals (space-separated)', () => {
    it('strips -C <path>', () => {
      expect(stripGitGlobalOptions(['-C', '/evil', 'worktree', 'add', 'foo'])).toEqual([
        'worktree',
        'add',
        'foo',
      ]);
    });

    it('strips -c <name>=<value>', () => {
      expect(stripGitGlobalOptions(['-c', 'user.email=x@y', 'commit', '-m', 'foo'])).toEqual([
        'commit',
        '-m',
        'foo',
      ]);
    });

    it('strips --git-dir <path>', () => {
      expect(stripGitGlobalOptions(['--git-dir', '/tmp/x', 'status'])).toEqual(['status']);
    });

    it('strips --work-tree <path>', () => {
      expect(stripGitGlobalOptions(['--work-tree', '/tmp/y', 'status'])).toEqual(['status']);
    });

    it('strips --namespace <name>', () => {
      expect(stripGitGlobalOptions(['--namespace', 'foo', 'fetch'])).toEqual(['fetch']);
    });

    it('strips --exec-path <path>', () => {
      expect(stripGitGlobalOptions(['--exec-path', '/usr/lib/git', 'status'])).toEqual(['status']);
    });
  });

  describe('value-consuming globals (=-joined)', () => {
    it('strips -C=/path', () => {
      expect(stripGitGlobalOptions(['-C=/evil', 'worktree', 'add', 'foo'])).toEqual([
        'worktree',
        'add',
        'foo',
      ]);
    });

    it('strips --git-dir=/path', () => {
      expect(stripGitGlobalOptions(['--git-dir=/tmp/x', 'status'])).toEqual(['status']);
    });
  });

  describe('flag-only globals (no value)', () => {
    it('strips -p', () => {
      expect(stripGitGlobalOptions(['-p', 'status'])).toEqual(['status']);
    });

    it('strips -P', () => {
      expect(stripGitGlobalOptions(['-P', 'status'])).toEqual(['status']);
    });

    it('strips --bare', () => {
      expect(stripGitGlobalOptions(['--bare', 'status'])).toEqual(['status']);
    });

    it('strips --paginate', () => {
      expect(stripGitGlobalOptions(['--paginate', 'log'])).toEqual(['log']);
    });

    it('strips --no-pager', () => {
      expect(stripGitGlobalOptions(['--no-pager', 'log'])).toEqual(['log']);
    });

    it('strips --no-replace-objects', () => {
      expect(stripGitGlobalOptions(['--no-replace-objects', 'status'])).toEqual(['status']);
    });

    it('strips --no-lazy-fetch', () => {
      expect(stripGitGlobalOptions(['--no-lazy-fetch', 'status'])).toEqual(['status']);
    });

    it('strips --no-advice', () => {
      expect(stripGitGlobalOptions(['--no-advice', 'status'])).toEqual(['status']);
    });
  });

  describe('combinations', () => {
    it('strips multiple globals in sequence', () => {
      expect(
        stripGitGlobalOptions(['-C', '/a', '-c', 'user.email=x@y.com', 'commit', '-m', 'foo']),
      ).toEqual(['commit', '-m', 'foo']);
    });

    it('preserves non-global flags', () => {
      expect(stripGitGlobalOptions(['-m', 'foo'])).toEqual(['-m', 'foo']);
    });

    it('preserves subcommand-level flags (after subcommand)', () => {
      expect(stripGitGlobalOptions(['commit', '-m', 'foo'])).toEqual(['commit', '-m', 'foo']);
    });

    it('passes through when no globals present', () => {
      expect(stripGitGlobalOptions(['worktree', 'add', 'foo'])).toEqual([
        'worktree',
        'add',
        'foo',
      ]);
    });

    it('passes through empty array', () => {
      expect(stripGitGlobalOptions([])).toEqual([]);
    });
  });

  describe('LD8 bypass scenarios (must strip)', () => {
    it('git -C /evil worktree add foo → worktree/add/foo', () => {
      const result = stripGitGlobalOptions(['-C', '/evil', 'worktree', 'add', 'foo']);
      expect(result[0]).toBe('worktree');
      expect(result[1]).toBe('add');
    });

    it('git --git-dir=/tmp/x worktree add → worktree/add after strip', () => {
      const result = stripGitGlobalOptions(['--git-dir=/tmp/x', 'worktree', 'add', 'foo']);
      expect(result[0]).toBe('worktree');
    });
  });
});
