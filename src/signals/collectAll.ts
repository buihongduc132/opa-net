/**
 * collectAll — runs multiple signal collectors and merges outputs.
 *
 * Fail-open: any collector throw → that signal is `{ available: false }`.
 * Never aborts the decision.
 */

import type { SignalCollector, SignalContext, Signals } from './types.ts';

/**
 * Run all collectors and merge their outputs into a Signals object.
 * Each collector's result is keyed by its `name` (e.g. 'git', 'repo', 'worktree', 'env').
 */
export function collectAll(
  collectors: readonly SignalCollector[],
  ctx: SignalContext,
): Signals {
  const result: Record<string, Record<string, unknown>> = {};

  for (const collector of collectors) {
    try {
      const signals = collector.collect(ctx);
      // Only include if at least partially available.
      if (signals && typeof signals === 'object') {
        result[collector.name] = signals;
      }
    } catch {
      // Fail-open: record as unavailable.
      result[collector.name] = { available: false };
    }
  }

  return result as Signals;
}
