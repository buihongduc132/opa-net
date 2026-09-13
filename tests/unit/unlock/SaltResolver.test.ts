import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaltResolver } from '../../../src/unlock/SaltResolver.ts';

describe('SaltResolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'piopanet-salt-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('reads existing salt', () => {
    it('returns the existing salt file content', () => {
      const saltPath = join(tempDir, 'salt');
      const saltContent = Buffer.from('existing-salt-32-bytes-exactly!!!');
      writeFileSync(saltPath, saltContent, { mode: 0o600 });

      const resolver = new SaltResolver({ saltPath });
      const result = resolver.resolve();
      expect(result).toEqual(saltContent);
    });
  });

  describe('auto-generates on first read', () => {
    it('creates a 32-byte salt file if missing', () => {
      const saltPath = join(tempDir, 'salt');
      // Precondition: file does not exist (statSync throws ENOENT).
      expect(() => statSync(saltPath)).toThrow();

      const resolver = new SaltResolver({ saltPath });
      const result = resolver.resolve();

      expect(result.length).toBe(32);
      const stat = statSync(saltPath);
      expect(stat.size).toBe(32);
    });

    it('creates the file with mode 0o600', () => {
      const saltPath = join(tempDir, 'salt');
      const resolver = new SaltResolver({ saltPath });
      resolver.resolve();

      const stat = statSync(saltPath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('returns consistent salt on subsequent reads', () => {
      const saltPath = join(tempDir, 'salt');
      const resolver = new SaltResolver({ saltPath });
      const first = resolver.resolve();
      const second = resolver.resolve();
      expect(first).toEqual(second);
    });

    it('generates cryptographically random bytes (non-deterministic across dirs)', () => {
      const saltPath1 = join(tempDir, 'salt1');
      const saltPath2 = join(tempDir, 'salt2');
      const r1 = new SaltResolver({ saltPath: saltPath1 }).resolve();
      const r2 = new SaltResolver({ saltPath: saltPath2 }).resolve();
      expect(r1).not.toEqual(r2);
    });
  });

  describe('atomic race on first-use (O_CREAT|O_EXCL)', () => {
    it('two concurrent resolves produce the same file', () => {
      const saltPath = join(tempDir, 'salt');
      const r1 = new SaltResolver({ saltPath });
      const r2 = new SaltResolver({ saltPath });
      const first = r1.resolve();
      const second = r2.resolve();
      expect(first).toEqual(second);
    });
  });

  describe('env literal override (PIOPANET_UNLOCK_SALT)', () => {
    afterEach(() => {
      delete process.env.PIOPANET_UNLOCK_SALT;
    });

    it('env literal overrides the file path', () => {
      const saltPath = join(tempDir, 'salt');
      process.env.PIOPANET_UNLOCK_SALT = 'test-salt-literal';
      const resolver = new SaltResolver({ saltPath });
      const result = resolver.resolve();
      expect(result).toEqual(Buffer.from('test-salt-literal'));
      // File should NOT be created when env override is used
      expect(() => statSync(saltPath)).toThrow();
    });
  });

  describe('env file path override (PIOPANET_UNLOCK_SALT_FILE)', () => {
    afterEach(() => {
      delete process.env.PIOPANET_UNLOCK_SALT_FILE;
    });

    it('reads salt from the env-specified file path', () => {
      const customSaltPath = join(tempDir, 'custom-salt');
      const saltContent = Buffer.from('custom-salt-32-bytes-exactly-here!');
      writeFileSync(customSaltPath, saltContent, { mode: 0o600 });
      process.env.PIOPANET_UNLOCK_SALT_FILE = customSaltPath;

      const resolver = new SaltResolver();
      const result = resolver.resolve();
      expect(result).toEqual(saltContent);
    });
  });

  describe('warns on world-readable salt', () => {
    it('emits a warning to stderr when salt mode is 0o644', () => {
      const saltPath = join(tempDir, 'salt');
      writeFileSync(saltPath, Buffer.from('insecure-salt-32-bytes-exactly!!'), { mode: 0o644 });
      chmodSync(saltPath, 0o644);

      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      let warned = false;
      process.stderr.write = ((chunk: any) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        if (
          text.includes('salt') &&
          (text.includes('mode') || text.includes('permission') || text.includes('world'))
        ) {
          warned = true;
        }
        return true;
      }) as any;

      try {
        const resolver = new SaltResolver({ saltPath });
        const result = resolver.resolve();
        expect(result.length).toBeGreaterThan(0);
        expect(warned).toBe(true);
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });
  });
});
