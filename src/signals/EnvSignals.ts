/**
 * Env signals — cross-platform home directory (OT17).
 *
 * Collects `signals.env.home` via `os.homedir()` which is cross-platform
 * (handles Windows USERPROFILE). Used by worktree-path-allowlist for tilde
 * expansion of allowed-prefix paths.
 */

import { homedir } from 'node:os';
import type { SignalCollector, SignalContext } from './types.ts';

export interface EnvSignal {
  readonly available: boolean;
  readonly home: string | null;
  /** Process cwd the guarded command would run in (repo/cwd allow-class). */
  readonly cwd: string | null;
}

export class EnvSignals implements SignalCollector {
  readonly name = 'env';

  collect(ctx: SignalContext): EnvSignal {
    const cwd = ctx.cwd || null;
    try {
      const home = homedir();
      return { available: !!home || !!cwd, home: home || null, cwd };
    } catch {
      return { available: false, home: null, cwd };
    }
  }
}
