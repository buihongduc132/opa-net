import { resolve } from 'node:path';
import { configFromEnv } from '../config/Config.ts';
import { OpaCliEngine, probeOpaVersion } from '../engine/index.ts';
import { DecisionBuilder } from '../output/DecisionBuilder.ts';
import { OutputFormatter, validateDecision } from '../output/OutputFormatter.ts';
import { CommandParserCoordinator } from '../parser/index.ts';
import { RULES, RuleRegistry } from '../rules/index.ts';

export interface CliOptions {
  /** Command string to evaluate. If omitted, read from stdin. */
  readonly command?: string;
  /** Output mode: json (full schema) | claude-code (suppress allow stdout). */
  readonly mode: 'json' | 'claude-code';
  /** Path to the .rego policy. */
  readonly policyPath: string;
}

export interface CliResult {
  readonly stdout: string;
  readonly exitCode: number;
}

/**
 * CLI entrypoint — wires parser → engine → builder → formatter.
 *
 * Returns {stdout, exitCode} instead of calling process.exit directly so it
 * is unit-testable. The bin wrapper calls process.exit with the returned code.
 */
export async function runCli(opts: CliOptions): Promise<CliResult> {
  const raw = resolveRaw(opts);
  if (raw === '') {
    return { stdout: '', exitCode: 0 };
  }

  const config = configFromEnv(opts.policyPath);
  const parser = new CommandParserCoordinator();
  const parsed = parser.parse(raw);

  const opaVersion = await probeOpaVersion(config.opaBinary ?? 'opa');
  const engine = new OpaCliEngine(config, opaVersion);
  const engineDecision = await engine.evaluate(parsed);

  const builder = new DecisionBuilder({
    config,
    registry: new RuleRegistry(RULES),
    digest: engine.rulebookDigest(),
  });
  const output = builder.build(parsed, engineDecision);

  // Hard internal gate: the record MUST validate against the schema before emit.
  validateDecision(output);

  const formatter = new OutputFormatter();
  const { stdout, exitCode } = formatter.format(output, opts.mode);
  return { stdout, exitCode };
}

function resolveRaw(opts: CliOptions): string {
  if (opts.command !== undefined && opts.command.length > 0) {
    return opts.command;
  }
  // Read stdin synchronously when no command arg given.
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

/** Resolve the default policy path relative to package root. */
export function defaultPolicyPath(): string {
  // import.meta.dir is available under Bun; fall back to cwd-relative for Node.
  const here = (import.meta as { dir?: string }).dir ?? process.cwd();
  return resolve(here, '../../policy/safety.rego');
}
