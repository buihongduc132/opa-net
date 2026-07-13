import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EngineConfig } from '../config/Config.ts';
import type { ParsedCommand } from '../parser/types.ts';
import type { Signals } from '../signals/types.ts';
import { sha256Prefix } from '../util/digest.ts';
import type { DecisionEngine, EngineDecision, RawDeny } from './types.ts';

const execFileAsync = promisify(execFile);

/**
 * OPA-backed decision engine via the `opa eval` CLI subprocess [LD1][LD2].
 *
 * - Spawns `opa eval -d <policy> -i <input.json> data.safety.allow + data.safety.deny`.
 * - On timeout / non-zero exit / unreachable binary → applies [OT2] fail-mode.
 * - fail-open: returns allow with source=fail-open.
 * - fail-closed: returns deny with source=fail-closed.
 *
 * Rego returns `deny` as a set of message strings; we map each to a RawDeny.
 */
export class OpaCliEngine implements DecisionEngine {
  readonly name = 'opa-cli';
  private readonly config: EngineConfig;
  private readonly digest: string;
  private readonly opaVersion: string;

  constructor(config: EngineConfig, opaVersion = '') {
    this.config = config;
    this.digest = sha256Prefix(this.config.policyPath, this.readFile);
    this.opaVersion = opaVersion;
  }

  async evaluate(
    parsed: ParsedCommand,
    opts?: { signals?: Signals; protectedBranches?: string[] },
  ): Promise<EngineDecision> {
    const input = {
      program: parsed.program,
      subcommand: parsed.subcommand,
      args: parsed.args,
      raw: parsed.raw,
      signals: opts?.signals ?? {},
    };
    const inputJson = JSON.stringify(input);
    const query = '{"allow": data.safety.allow, "deny": data.safety.deny}';
    const args = ['eval', '--format', 'json', '-d', this.config.policyPath];

    const start = Date.now();
    let tmpDir: string | null = null;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'pi-opa-'));
      const inFile = join(tmpDir, 'in.json');
      writeFileSync(inFile, inputJson);
      const fullArgs = [...args];
      // Protected branches are supplied as a data document so the rego rule
      // reads them from `data.config.protected_branches`. Empty/undefined →
      // no data document → the rule never matches.
      const branches = opts?.protectedBranches;
      if (branches && branches.length > 0) {
        const dataFile = join(tmpDir, 'data.json');
        writeFileSync(dataFile, JSON.stringify({ config: { protected_branches: branches } }));
        fullArgs.push('-d', dataFile);
      }
      fullArgs.push('-i', inFile, query);
      const { stdout } = await execFileAsync(this.resolveBinary(), fullArgs, {
        timeout: this.config.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      });
      const durationMs = Date.now() - start;
      const parsedOut = parseOpaOutput(stdout);
      const denies = extractDenies(parsedOut.deny);
      const allow = parsedOut.allow === true;
      return {
        decision: allow ? 'allow' : 'deny',
        source: 'opa',
        reasons: allow ? [] : denies,
        opaVersion: this.opaVersion,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      return this.failModeDecision(durationMs, err);
    } finally {
      if (tmpDir) {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  rulebookDigest(): string {
    return this.digest;
  }

  private resolveBinary(): string {
    return this.config.opaBinary ?? 'opa';
  }

  // Allow injecting a reader for testability without leaking fs into constructor.
  private readFile = (path: string): string => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      return fs.readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };

  private failModeDecision(durationMs: number, err: unknown): EngineDecision {
    const message = err instanceof Error ? err.message : String(err);
    if (this.config.failMode === 'closed') {
      return {
        decision: 'deny',
        source: 'fail-closed',
        reasons: [{ message: `OPA unreachable (${this.config.failMode} mode): ${message}` }],
        opaVersion: '',
        durationMs,
      };
    }
    return {
      decision: 'allow',
      source: 'fail-open',
      reasons: [],
      opaVersion: '',
      durationMs,
    };
  }
}

interface OpaResult {
  allow?: unknown;
  deny?: unknown;
}

function parseOpaOutput(stdout: string): OpaResult {
  const doc = JSON.parse(stdout) as {
    result?: Array<{ expressions: Array<{ value: unknown }> }>;
  };
  // Single object query → one expression whose value is {allow, deny}.
  const value = doc.result?.[0]?.expressions?.[0]?.value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return { allow: v.allow, deny: v.deny };
  }
  return {};
}

function extractDenies(denyValue: unknown): RawDeny[] {
  if (!denyValue || typeof denyValue !== 'object') return [];
  // When queried inside an object construction ({"deny": data.safety.deny}),
  // a Rego set serializes as {message: true}. When queried directly it's an
  // array. Handle both.
  if (Array.isArray(denyValue)) {
    return denyValue
      .filter((m): m is string => typeof m === 'string')
      .map((message) => ({ message }));
  }
  if (denyValue instanceof Object) {
    return Object.keys(denyValue as Record<string, unknown>).map((message) => ({ message }));
  }
  return [];
}

/** Probe `opa version` once; returns the version string or ''. */
export async function probeOpaVersion(binary: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(binary, ['version'], { timeout: 2000 });
    const match = /Version:\s*([0-9][^\s]*)/.exec(stdout);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}
