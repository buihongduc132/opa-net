// Public API for pi-opa-net — agent-agnostic engine + structured output.
//
// Consumers: pi extension (future pi-opa-net-ext), scripts, other agents.
// CLI entrypoint lives in src/cli/run.ts.

export { configFromEnv, resolveOpaBinary } from './config/Config.ts';
export type { EngineConfig, FailMode } from './config/Config.ts';

export { CommandParserCoordinator, RegexFallbackParser, ShellQuoteParser } from './parser/index.ts';
export type { CommandParser, ParseConfidence, ParsedCommand } from './parser/index.ts';

export { OpaCliEngine, probeOpaVersion } from './engine/index.ts';
export type { DecisionEngine, EngineDecision, RawDeny } from './engine/index.ts';

export { RULES, RuleRegistry, inferFamilyFromProgram } from './rules/index.ts';
export type { RuleFamily, RuleMeta } from './rules/index.ts';

export {
  DecisionBuilder,
  OutputFormatter,
  isValidDecision,
  validateDecision,
} from './output/index.ts';
export type {
  DecisionMetadata,
  DecisionOutput,
  EvaluatedInput,
  OutputMode,
  Reason,
} from './output/index.ts';

export { sha256Prefix } from './util/digest.ts';
