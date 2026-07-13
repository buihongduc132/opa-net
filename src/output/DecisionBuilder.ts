import { randomUUID } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import type { EngineConfig } from '../config/Config.ts';
import type { EngineDecision, RawDeny } from '../engine/types.ts';
import type { ParsedCommand } from '../parser/types.ts';
import { type RuleMeta, type RuleRegistry, inferFamilyFromProgram } from '../rules/index.ts';

/** The schema-compliant decision output (decision-output.v1). */
export interface DecisionOutput {
  readonly schema_version: '1.0';
  readonly decision: 'allow' | 'deny';
  readonly action: 'allow' | 'block' | 'prompt_user' | 'log_only';
  readonly source: 'opa' | 'fail-open' | 'fail-closed' | 'cached';
  readonly reasons: readonly Reason[];
  readonly input: EvaluatedInput;
  readonly summary: string;
  readonly suggestions: string[];
  readonly metadata: DecisionMetadata;
  readonly evaluated_at: string;
  readonly decision_id: string;
  readonly duration_ms: number;
}

export interface Reason {
  readonly rule_id: string;
  readonly message: string;
  readonly family: string;
  readonly severity: 'block' | 'warn' | 'info';
}

export interface EvaluatedInput {
  readonly raw: string;
  readonly program: string;
  readonly subcommand: string;
  readonly args: string[];
  readonly parse_confidence: 'full' | 'partial' | 'regex-only' | 'failed';
}

export interface DecisionMetadata {
  readonly engine: 'opa';
  readonly opa_version: string;
  readonly rulebook_digest: string;
  readonly policy_path: string;
  readonly hostname: string;
  readonly session_id: string;
}

export interface DecisionBuilderDeps {
  readonly config: EngineConfig;
  readonly registry: RuleRegistry;
  readonly digest: string;
  /** Inject now() for deterministic tests. */
  readonly now?: () => Date;
  /** Inject uuid for deterministic tests. */
  readonly uuid?: () => string;
}

/**
 * Builds the decision-output.v1 record from engine result + parsed input.
 *
 * OOP: this class owns the schema-shape assembly. It does NOT decide — it
 * translates an EngineDecision + ParsedCommand into the auditable record.
 * DRY: provenance lookup (registry), summary formatting, and suggestion
 * aggregation each happen in exactly one place.
 */
export class DecisionBuilder {
  private readonly deps: DecisionBuilderDeps;

  constructor(deps: DecisionBuilderDeps) {
    this.deps = deps;
  }

  build(parsed: ParsedCommand, engine: EngineDecision): DecisionOutput {
    const reasons = engine.decision === 'deny' ? this.buildReasons(engine.reasons, parsed) : [];
    const suggestions = this.collectSuggestions(reasons);
    const action = engine.decision === 'allow' ? 'allow' : 'block';
    return {
      schema_version: '1.0',
      decision: engine.decision,
      action,
      source: engine.source,
      reasons,
      input: {
        raw: parsed.raw,
        program: parsed.program,
        subcommand: parsed.subcommand,
        args: [...parsed.args],
        parse_confidence: parsed.parseConfidence,
      },
      summary: this.summary(engine, parsed, reasons),
      suggestions,
      metadata: {
        engine: 'opa',
        opa_version: engine.opaVersion,
        rulebook_digest: this.deps.digest,
        policy_path: this.deps.config.policyPath,
        hostname: this.deps.config.hostname ?? osHostname(),
        session_id: this.deps.config.sessionId ?? '',
      },
      evaluated_at: (this.deps.now ?? (() => new Date()))().toISOString(),
      decision_id: (this.deps.uuid ?? randomUUID)(),
      duration_ms: engine.durationMs,
    };
  }

  private buildReasons(raw: readonly RawDeny[], parsed: ParsedCommand): Reason[] {
    return raw.map((d) => {
      const familyHint = inferFamilyFromProgram(parsed.program);
      const meta = this.deps.registry.lookup(d, familyHint, parsed.args);
      return {
        rule_id: meta.ruleId,
        message: meta.message,
        family: this.resolveFamily(meta, parsed),
        severity: 'block' as const,
      };
    });
  }

  /** Use registered family; fall back to program-inferred family for sprintf rules. */
  private resolveFamily(meta: RuleMeta, parsed: ParsedCommand): string {
    if (meta.family !== 'custom') return meta.family;
    const inferred = inferFamilyFromProgram(parsed.program);
    return inferred;
  }

  private collectSuggestions(reasons: readonly Reason[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of reasons) {
      const meta = this.findMetaByMessage(r.message);
      if (meta?.suggestions) {
        for (const s of meta.suggestions) {
          if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
          }
        }
      }
    }
    return out;
  }

  private findMetaByMessage(message: string): RuleMeta | undefined {
    // Registry exposes lookup via RawDeny; reuse isKnown + synthesize-free path.
    const synth = this.deps.registry.lookup({ message });
    return synth.ruleId.startsWith('custom:') ? undefined : synth;
  }

  private summary(
    engine: EngineDecision,
    parsed: ParsedCommand,
    reasons: readonly Reason[],
  ): string {
    if (engine.decision === 'allow') {
      if (engine.source === 'fail-open' || engine.source === 'fail-closed') {
        return `ALLOWED (${engine.source}: OPA unreachable for ${engine.durationMs}ms)`;
      }
      return '';
    }
    const first = reasons[0];
    const rule = first ? ` (rule: ${first.rule_id})` : '';
    return `BLOCKED: ${parsed.raw}${rule}`;
  }
}
