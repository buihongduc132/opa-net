import { resolve } from 'node:path';
import { configFromEnv } from '../config/Config.ts';
import { OpaCliEngine, probeOpaVersion } from '../engine/index.ts';
import { DecisionBuilder, type DecisionOutput } from '../output/DecisionBuilder.ts';
import { OutputFormatter, validateDecision } from '../output/OutputFormatter.ts';
import { CommandParserCoordinator } from '../parser/index.ts';
import { RULES, RuleRegistry } from '../rules/index.ts';
import { SaltResolver } from '../unlock/SaltResolver.ts';
import { UnlockFilter } from '../unlock/UnlockFilter.ts';
import type { UnlockResult } from '../unlock/types.ts';

export interface CliOptions {
  /** Command string to evaluate. If omitted, read from stdin. */
  readonly command?: string;
  /** Output mode: json (full schema) | claude-code (suppress allow stdout). */
  readonly mode: 'json' | 'claude-code';
  /** Path to the .rego policy. */
  readonly policyPath: string;
  /** Unlock keys from --unlock flags (repeatable). */
  readonly unlockKeys?: readonly string[];
  /** Read a single unlock key from stdin (requires positional command). */
  readonly unlockStdin?: boolean;
  /** Injected stdin content (for testing — bypasses fd 0 read). */
  readonly stdin?: string;
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
  // LD-G2: --unlock-stdin requires a positional command argument.
  if (opts.unlockStdin && (!opts.command || opts.command.length === 0)) {
    throw new Error('--unlock-stdin requires a positional command argument');
  }

  const raw = resolveRaw(opts);
  if (raw === '') {
    return { stdout: '', exitCode: 0 };
  }

  // Read unlock key from stdin if --unlock-stdin [LD-L4].
  let stdinKey: string | undefined;
  if (opts.unlockStdin) {
    stdinKey = readStdinKey(opts);
  }

  const config = configFromEnv(opts.policyPath);

  // Collect unlock keys from all channels: ENV + --unlock + --unlock-stdin.
  const unlockKeys = dedupe([
    ...(config.unlockKeys ?? []),
    ...(opts.unlockKeys ?? []),
    ...(stdinKey ? [stdinKey] : []),
  ]);
  const hasKeys = unlockKeys.length > 0;

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

  let output: DecisionOutput;

  if (engineDecision.source === 'fail-open' && hasKeys) {
    // LD-G1: OPA down + keys present → fail-open-keyless (NOT opa-unlocked).
    output = builder.build(parsed, engineDecision);
    output = { ...output, source: 'fail-open-keyless' };
  } else if (!hasKeys || engineDecision.decision === 'allow') {
    // No keys or engine said allow → no unlock filtering.
    output = builder.build(parsed, engineDecision);
  } else {
    // Engine said deny + keys present → run unlock filter [D1].
    let unlockResult: UnlockResult | undefined;
    let filterCrashed = false;

    const salt = new SaltResolver({ saltPath: config.unlockSaltPath ?? '' }).resolve();
    try {
      unlockResult = UnlockFilter.filter(
        engineDecision.reasons,
        unlockKeys,
        salt,
        Date.now(),
        new RuleRegistry(RULES),
      );
    } catch {
      // LD-G8: filter crash → fall back to un-filtered engine decision.
      filterCrashed = true;
    }

    if (filterCrashed) {
      output = builder.build(parsed, engineDecision);
      output = { ...output, source: 'unlock-filter-error' };
    } else {
      output = builder.build(parsed, engineDecision, { unlockResult });
    }
  }

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

/** Read a single unlock key from stdin (or injected opts.stdin for testing). */
function readStdinKey(opts: CliOptions): string {
  if (opts.stdin !== undefined) {
    return opts.stdin.trim();
  }
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

/** De-duplicate a string array while preserving order. */
function dedupe(arr: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Resolve the default policy path relative to package root. */
export function defaultPolicyPath(): string {
  // import.meta.dir is available under Bun; fall back to cwd-relative for Node.
  const here = (import.meta as { dir?: string }).dir ?? process.cwd();
  return resolve(here, '../../policy/safety.rego');
}
