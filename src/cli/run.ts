import { resolve } from 'node:path';
import { type EngineConfig, configFromEnv } from '../config/Config.ts';
import {
  type DecisionEngine,
  type EngineDecision,
  OpaCliEngine,
  probeOpaVersion,
} from '../engine/index.ts';
import { DecisionBuilder, type DecisionOutput } from '../output/DecisionBuilder.ts';
import { OutputFormatter, validateDecision } from '../output/OutputFormatter.ts';
import type { CommandParser, ParsedCommand } from '../parser/index.ts';
import { CommandParserCoordinator } from '../parser/index.ts';
import { classifyCheckoutTarget } from '../parser/checkoutTarget.ts';
import { RULES, RuleRegistry } from '../rules/index.ts';
import {
  EnvSignals,
  RepoSignals,
  WorktreeSignals,
  collectAll,
  type Signals,
} from '../signals/index.ts';
import type { SignalContext } from '../signals/types.ts';
import { SaltResolver } from '../unlock/SaltResolver.ts';
import { UnlockFilter } from '../unlock/UnlockFilter.ts';
import type { UnlockResult } from '../unlock/types.ts';
import { canonicalizePath } from '../util/canonicalizePath.ts';

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
  const opaVersion = await probeOpaVersion(config.opaBinary ?? 'opa');
  const engine = new OpaCliEngine(config, opaVersion);

  const builder = new DecisionBuilder({
    config,
    registry: new RuleRegistry(RULES),
    digest: engine.rulebookDigest(),
  });

  // Collect signals for git commands (lazy: only when program === 'git').
  const cwd = process.cwd();
  const collectors = [new RepoSignals(), new WorktreeSignals(), new EnvSignals()];

  // Compound commands (joined by ';'): split and evaluate EACH segment.
  // If ANY segment is denied, the whole command is denied. This catches
  // env-prefixed commands like `export FOO=bar; git stash pop` where
  // pi-bash-guard prepends env exports to every bash invocation.
  const output = await evaluatePossiblyCompound(raw, {
    parser,
    engine,
    config,
    builder,
    unlockKeys,
    hasKeys,
    cwd,
    collectors,
  });

  // Hard internal gate: the record MUST validate against the schema before emit.
  validateDecision(output);

  const formatter = new OutputFormatter();
  const { stdout, exitCode } = formatter.format(output, opts.mode);
  return { stdout, exitCode };
}

/**
 * Evaluate a possibly-compound raw command string. If it contains ';',
 * evaluate each segment and return deny if ANY segment is denied.
 * Single commands (no ';') take the existing fast path unchanged.
 */
async function evaluatePossiblyCompound(
  raw: string,
  deps: {
    parser: CommandParser;
    engine: DecisionEngine;
    config: EngineConfig;
    builder: DecisionBuilder;
    unlockKeys: readonly string[];
    hasKeys: boolean;
    cwd: string;
    collectors: readonly import('../signals/types.ts').SignalCollector[];
  },
): Promise<DecisionOutput> {
  const { parser, engine, config, builder, unlockKeys, hasKeys, cwd, collectors } = deps;

  // Split on ';' but only treat as compound if more than one non-empty segment.
  const segments = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length <= 1) {
    // Single command path — unchanged behavior.
    const parsed = parser.parse(raw);
    const signals = collectSignals(parsed, cwd, raw, config, collectors);
    const engineDecision = await engine.evaluate(parsed, signals);
    return buildDecision(parsed, engineDecision, { config, builder, unlockKeys, hasKeys });
  }

  // Compound path: evaluate each segment, deny wins.
  let denyOutput: DecisionOutput | undefined;
  for (const segment of segments) {
    const parsed = parser.parse(segment);
    const signals = collectSignals(parsed, cwd, segment, config, collectors);
    const engineDecision = await engine.evaluate(parsed, signals);
    const output = buildDecision(parsed, engineDecision, { config, builder, unlockKeys, hasKeys });
    if (output.decision === 'deny' && output.action === 'block') {
      denyOutput = output;
      break; // first deny wins
    }
  }

  if (denyOutput) {
    return denyOutput;
  }

  // All segments allowed — return an allow decision based on the first segment.
  const firstParsed = parser.parse(segments[0] ?? '');
  const firstSignals = collectSignals(firstParsed, cwd, segments[0] ?? '', config, collectors);
  const firstEngineDecision = await engine.evaluate(firstParsed, firstSignals);
  return buildDecision(firstParsed, firstEngineDecision, {
    config,
    builder,
    unlockKeys,
    hasKeys,
  });
}

/** Build a DecisionOutput from a parsed command + engine decision, applying unlock keys. */
function buildDecision(
  parsed: ParsedCommand,
  engineDecision: EngineDecision,
  deps: {
    config: EngineConfig;
    builder: DecisionBuilder;
    unlockKeys: readonly string[];
    hasKeys: boolean;
  },
): DecisionOutput {
  const { config, builder, unlockKeys, hasKeys } = deps;

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

  return output;
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

/**
 * Collect signals for a parsed git command and canonicalize worktree paths.
 * Returns a merged Signals object ready to inject into the OPA input.
 */
function collectSignals(
  parsed: ParsedCommand,
  cwd: string,
  raw: string,
  config: EngineConfig,
  collectors: readonly import('../signals/types.ts').SignalCollector[],
): Signals | undefined {
  if (parsed.program !== 'git') {
    return undefined;
  }

  const ctx: SignalContext = { cwd, raw, parsed };
  const signals = collectAll(collectors, ctx);

  // Enrich git signals with target_branch classification (LD7).
  if (parsed.subcommand === 'checkout' || parsed.subcommand === 'switch') {
    const target = classifyCheckoutTarget(parsed.args, cwd);
    (signals as Record<string, Record<string, unknown>>).git = {
      available: true,
      current_branch: null, // not collected here — RepoSignals could be extended
      target_branch: target.kind === 'branch' ? target.name : null,
      target_kind: target.kind,
    };
  }

  // Canonicalize worktree target path (LD6) and add to signals.
  const worktreeSignal = signals.worktree as
    | { target_path?: string | null; available?: boolean }
    | undefined;
  if (worktreeSignal?.target_path) {
    const targetPath = worktreeSignal.target_path;
    // Resolve relative to cwd.
    const { resolve, isAbsolute } = require('node:path') as typeof import('node:path');
    const absTarget = resolve(cwd, targetPath);
    // Resolve relative allowed dirs against cwd.
    const allowedDirs = (config.worktreeAllowedDirs ?? []).map((d) =>
      isAbsolute(d) ? d : resolve(cwd, d),
    );
    const canon = canonicalizePath(absTarget, allowedDirs);
    (signals as Record<string, Record<string, unknown>>).worktree = {
      ...worktreeSignal,
      target_path: absTarget,
      resolved_path: canon.resolvedTarget ?? absTarget,
      path_allowed: canon.allowed,
      path_reject_reason: canon.reason,
      resolved_allowed_prefixes: canon.resolvedPrefixes,
    };
  }

  return signals;
}
