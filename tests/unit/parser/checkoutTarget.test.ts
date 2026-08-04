import { describe, expect, it } from 'bun:test';
import { classifyCheckoutTarget } from '../../../src/parser/checkoutTarget.ts';

describe('classifyCheckoutTarget', () => {
  describe('file restore (pathspec form)', () => {
    it('detects -- separator → file-restore', () => {
      expect(classifyCheckoutTarget(['--', 'src/app.ts'])).toEqual({ kind: 'file-restore' });
    });

    it('detects -- with no files → file-restore', () => {
      expect(classifyCheckoutTarget(['--'])).toEqual({ kind: 'file-restore' });
    });

    it('detects branch -- file.ts → file-restore', () => {
      expect(classifyCheckoutTarget(['feature', '--', 'src/app.ts'])).toEqual({
        kind: 'file-restore',
      });
    });
  });

  describe('detached HEAD', () => {
    it('detects --detach flag', () => {
      expect(classifyCheckoutTarget(['--detach', 'abc1234'])).toEqual({ kind: 'detached' });
    });

    it('detects -d flag', () => {
      expect(classifyCheckoutTarget(['-d', 'abc1234'])).toEqual({ kind: 'detached' });
    });

    it('detects - (previous branch) as detached', () => {
      expect(classifyCheckoutTarget(['-'])).toEqual({ kind: 'detached' });
    });
  });

  describe('branch classification (no cwd → assume branch)', () => {
    it('bare branch name → branch', () => {
      expect(classifyCheckoutTarget(['feature'])).toEqual({ kind: 'branch', name: 'feature' });
    });

    it('strips origin/ prefix → branch with stripped name', () => {
      expect(classifyCheckoutTarget(['origin/feature'])).toEqual({
        kind: 'branch',
        name: 'feature',
      });
    });

    it('strips upstream/ prefix', () => {
      expect(classifyCheckoutTarget(['upstream/develop'])).toEqual({
        kind: 'branch',
        name: 'develop',
      });
    });
  });

  describe('edge cases', () => {
    it('empty args → none', () => {
      expect(classifyCheckoutTarget([])).toEqual({ kind: 'none' });
    });

    it('flags only with --detach → detached', () => {
      expect(classifyCheckoutTarget(['--detach'])).toEqual({ kind: 'detached' });
    });

    it('flags only without --detach → none', () => {
      expect(classifyCheckoutTarget(['-f'])).toEqual({ kind: 'none' });
    });

    it('strips -b flag before positional', () => {
      expect(classifyCheckoutTarget(['-b', 'new-branch'])).toEqual({
        kind: 'branch',
        name: 'new-branch',
      });
    });
  });
});
