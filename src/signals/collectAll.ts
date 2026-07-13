import type { SignalCollector, SignalContext, Signals } from './types.ts';

/**
 * Merge an array of SignalCollectors into a single Signals object (design D2).
 *
 * Each collector's output is keyed under `result[collector.name]`. A collector
 * that throws is suppressed — its signal becomes `{ available: false }` and the
 * remaining collectors still merge. An empty array yields `{}`.
 */
export function collectAll(collectors: SignalCollector[], ctx: SignalContext): Signals {
  const result: Signals = {};
  for (const collector of collectors) {
    try {
      result[collector.name] = collector.collect(ctx);
    } catch {
      result[collector.name] = { available: false };
    }
  }
  return result;
}
