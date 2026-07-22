import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Salt resolution seam [D4 / LD-Y1].
 *
 * Precedence (first wins):
 *   1. `PIOPANET_UNLOCK_SALT` env — literal value (for testing).
 *   2. `saltPath` constructor option or `PIOPANET_UNLOCK_SALT_FILE` env — file path.
 *   3. Auto-generate 32 random bytes at the file path (atomic `wx`, mode 0o600).
 *
 * On read, warns to stderr if the file mode is not 0o600.
 */
export interface SaltResolverOptions {
  /** Explicit salt file path (typically from config.unlockSaltPath). */
  readonly saltPath?: string;
}

const ENV = process.env;

export class SaltResolver {
  private readonly saltPath?: string;

  constructor(opts: SaltResolverOptions = {}) {
    this.saltPath = opts.saltPath ?? ENV.PIOPANET_UNLOCK_SALT_FILE ?? defaultSaltPath();
  }

  resolve(): Buffer {
    // 1. PIOPANET_UNLOCK_SALT env — literal value OR path to an existing file.
    //    If the value points to an existing file, read it; otherwise treat as literal.
    const envSalt = ENV.PIOPANET_UNLOCK_SALT;
    if (envSalt !== undefined) {
      try {
        const stat = statSync(envSalt);
        if (stat.isFile()) {
          warnIfBadMode(envSalt);
          return readFileSync(envSalt);
        }
      } catch {
        // Not an existing file path — fall through to literal.
      }
      return Buffer.from(envSalt);
    }

    const path = this.saltPath ?? defaultSaltPath();

    // 2. Existing file — read + warn on bad mode.
    if (existsSync(path)) {
      warnIfBadMode(path);
      return readFileSync(path);
    }

    // 3. Auto-generate atomically (O_CREAT | O_EXCL via flag:'wx').
    ensureDir(path);
    const generated = randomBytes(32);
    try {
      writeFileSync(path, generated, { flag: 'wx', mode: 0o600 });
      return generated;
    } catch (e) {
      // Race: another process created the file between our existsSync and writeFileSync.
      // Re-read the winner's file (no last-write-wins).
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EEXIST' && existsSync(path)) {
        warnIfBadMode(path);
        return readFileSync(path);
      }
      throw e;
    }
  }
}

function defaultSaltPath(): string {
  const home = ENV.HOME ?? process.env.HOME ?? '';
  return join(home, '.pi-opa-net', 'salt');
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // Directory may already exist — ignore.
  }
}

function warnIfBadMode(path: string): void {
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) {
      process.stderr.write(
        `warning: salt file ${path} has mode ${mode.toString(8)} (expected 0o600); other users on this host can read it and derive unlock keys.\n`,
      );
    }
  } catch {
    // Stat failed — nothing to warn about.
  }
}
