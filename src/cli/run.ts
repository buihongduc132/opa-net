import { resolve } from 'node:path';
import { configFromEnv } from '../config/Config.ts';
import { OpaCliEngine, probeOpaVersion } from '../engine/index.ts';
import { DecisionBuilder } from '../output/DecisionBuilder.ts';
import { OutputFormatter, validateDecision } from '../output/OutputFormatter.ts';
import { CommandParserCoordinator } from '../parser/index.ts';
import { RULES, RuleRegistry } from '../rules/index.ts';
import { GitSignals, collectAll } from '../signals/index.ts';
import type { SignalContext } from '../signals/index.ts';

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

  // Collect context signals only for branch-switching ops (D3/D5); other
  // commands get an empty signals object.
  const isBranchOp =
    parsed.program === 'git' &&
    (parsed.subcommand === 'checkout' || parsed.subcommand === 'switch');
  const signals = isBranchOp ? collectAll([new GitSignals()], buildSignalContext(raw, parsed)) : {};

  const opaVersion = await probeOpaVersion(config.opaBinary ?? 'opa');
  const engine = new OpaCliEngine(config, opaVersion);
  const engineDecision = await engine.evaluate(parsed, {
    signals,
    protectedBranches: config.protectedBranches,
  });

  const builder = new DecisionBuilder({
    config,
    registry: new RuleRegistry(RULES),
    digest: engine.rulebookDigest(),
  });
  const output = builder.build(parsed, engineDecision, signals);

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

/**
 * Build a SignalContext from the cwd + parsed command.
 *
 * `ParsedCommand.args` is `readonly string[]` for immutability; the signals
 * contract uses a mutable `string[]`, so we copy here to avoid a cast.
 */
function buildSignalContext(
  raw: string,
  parsed: ReturnType<CommandParserCoordinator['parse']>,
): SignalContext {
  // Resolve cwd defensively: if the cwd was deleted mid-session,
  // process.cwd() throws — fall back to '.' to preserve the fail-open
  // guarantee rather than crashing the whole decision.
  const cwd = (() => {
    try {
      return process.cwd();
    } catch {
      return '.';
    }
  })();
  return {
    cwd,
    raw,
    parsed: {
      program: parsed.program,
      subcommand: parsed.subcommand,
      args: [...parsed.args],
      raw: parsed.raw,
      parseConfidence: parsed.parseConfidence,
    },
  };
}
