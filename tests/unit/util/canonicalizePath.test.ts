import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizePath } from '../../../src/util/canonicalizePath.ts';

describe('canonicalizePath', () => {
  const tmpDir = join('/tmp', 'opa-net-canonicalize-test');

  beforeAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, 'allowed'), { recursive: true });
    mkdirSync(join(tmpDir, 'evil'), { recursive: true });
    writeFileSync(join(tmpDir, 'allowed', 'file.txt'), 'ok');
    writeFileSync(join(tmpDir, 'evil', 'file.txt'), 'bad');
    // Create a symlink from allowed/link → evil/
    try {
      symlinkSync(join(tmpDir, 'evil'), join(tmpDir, 'allowed', 'link'));
    } catch {
      // Symlink creation may fail in some environments.
    }
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('allowed paths', () => {
    it('allows path under allowed prefix', () => {
      const result = canonicalizePath(join(tmpDir, 'allowed', 'file.txt'), [
        join(tmpDir, 'allowed'),
      ]);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows exact match with allowed prefix', () => {
      const result = canonicalizePath(join(tmpDir, 'allowed'), [join(tmpDir, 'allowed')]);
      expect(result.allowed).toBe(true);
    });
  });

  describe('denied paths', () => {
    it('denies path outside allowed prefix', () => {
      const result = canonicalizePath(join(tmpDir, 'evil', 'file.txt'), [
        join(tmpDir, 'allowed'),
      ]);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('path-outside-allowed');
    });

    it('denies .. traversal', () => {
      const result = canonicalizePath(join(tmpDir, 'allowed', '..', '..', 'evil', 'file.txt'), [
        join(tmpDir, 'allowed'),
      ]);
      expect(result.allowed).toBe(false);
    });

    it('denies symlink escape', () => {
      const result = canonicalizePath(join(tmpDir, 'allowed', 'link', 'file.txt'), [
        join(tmpDir, 'allowed'),
      ]);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('path-outside-allowed');
    });
  });

  describe('boundary enforcement', () => {
    it('denies path with similar prefix (boundary-enforced)', () => {
      // /tmp/opa-net-canonicalize-test/allowed-evil should NOT match /tmp/opa-net-canonicalize-test/allowed
      const evilDir = join(tmpDir, 'allowed-evil');
      mkdirSync(evilDir, { recursive: true });
      writeFileSync(join(evilDir, 'file.txt'), 'bad');

      const result = canonicalizePath(join(evilDir, 'file.txt'), [join(tmpDir, 'allowed')]);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('path-outside-allowed');
    });
  });

  describe('forbidden basenames', () => {
    it('denies .git-named target', () => {
      const gitDir = join(tmpDir, 'allowed', '.git');
      mkdirSync(gitDir, { recursive: true });

      const result = canonicalizePath(gitDir, [join(tmpDir, 'allowed')]);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('forbidden-basename');
    });
  });

  describe('realpath failure', () => {
    it('denies non-existent target', () => {
      const result = canonicalizePath(join(tmpDir, 'nonexistent'), [join(tmpDir, 'allowed')]);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('realpath-failed');
    });
  });

  describe('empty allowed prefixes', () => {
    it('allows when no prefixes provided (rule inert)', () => {
      const result = canonicalizePath(join(tmpDir, 'allowed', 'file.txt'), []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('no-allowed-prefixes');
    });
  });
});
