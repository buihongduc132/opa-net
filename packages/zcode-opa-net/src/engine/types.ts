import type { ParsedCommand } from '../parser/types.ts';

/**
 * Raw deny reasons from the engine (before provenance enrichment).
 * OPA returns a set of message strings; richer engines may return structured.
 */
export interface RawDeny {
  readonly message: string;
}

/** Outcome of an engine evaluation. */
export interface EngineDecision {
  /** Verdict. */
  readonly decision: 'allow' | 'deny';
  /** Where the decision came from: opa | fail-open | fail-closed | cached. */
  readonly source: 'opa' | 'fail-open' | 'fail-closed' | 'cached';
  /** Fired deny reasons (empty on allow). */
  readonly reasons: readonly RawDeny[];
  /** OPA version string (empty when not from live OPA). */
  readonly opaVersion: string;
  /** Wall-clock duration in ms. */
  readonly durationMs: number;
}

/**
 * Decision engine interface [LD1: OPA].
 * OpaCliEngine is the reference implementation; the interface allows fakes/mocks.
 */
export interface DecisionEngine {
  readonly name: string;
  /** Evaluate the parsed command against the policy. */
  evaluate(parsed: ParsedCommand): Promise<EngineDecision>;
  /** SHA-256 prefix (12 hex) of the active policy bundle — for drift detection. */
  rulebookDigest(): string;
}
