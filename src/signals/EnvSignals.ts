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
}

export class EnvSignals implements SignalCollector {
  readonly name = 'env';

  collect(_ctx: SignalContext): EnvSignal {
    try {
      const home = homedir();
      return { available: !!home, home: home || null };
    } catch {
      return { available: false, home: null };
    }
  }
}
