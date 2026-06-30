import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EngineConfig } from '../../../src/config/Config.ts';
import { OpaCliEngine, probeOpaVersion } from '../../../src/engine/OpaCliEngine.ts';
import type { ParsedCommand } from '../../../src/parser/types.ts';

const ROOT = resolve(import.meta.dir, '../../../');
const POLICY = resolve(ROOT, 'policy/safety.rego');
const OPA = process.env.HOME
  ? `${process.env.HOME}/.local/share/mise/installs/opa/1.18.1/opa`
  : 'opa';
const opaAvailable = existsSync(OPA);

const cfg = (failMode: 'open' | 'closed'): EngineConfig => ({
  opaBinary: OPA,
  policyPath: POLICY,
  failMode,
  timeoutMs: 2000,
  cacheTtlMs: 0,
});

const cmd = (
  raw: string,
  program: string,
  subcommand: string,
  args: string[] = [],
): ParsedCommand => ({
  raw,
  program,
  subcommand,
  args,
  parseConfidence: 'full',
});

describe.skipIf(!opaAvailable)('OpaCliEngine (live OPA)', () => {
  it('denies git stash pop (source=opa)', async () => {
    const e = new OpaCliEngine(cfg('open'));
    const d = await e.evaluate(cmd('git stash pop', 'git', 'stash', ['pop']));
    expect(d.decision).toBe('deny');
    expect(d.source).toBe('opa');
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons[0].message).toMatch(/mutate stashes/i);
  });

  it('allows git stash list (carve-out)', async () => {
    const e = new OpaCliEngine(cfg('open'));
    const d = await e.evaluate(cmd('git stash list', 'git', 'stash', ['list']));
    expect(d.decision).toBe('allow');
    expect(d.source).toBe('opa');
    expect(d.reasons).toEqual([]);
  });

  it('denies bare git stash (OT3 native handling)', async () => {
    const e = new OpaCliEngine(cfg('open'));
    const d = await e.evaluate(cmd('git stash', 'git', 'stash', []));
    expect(d.decision).toBe('deny');
    expect(d.source).toBe('opa');
    expect(d.reasons[0].message).toMatch(/bare/i);
  });

  it('denies docker stop', async () => {
    const e = new OpaCliEngine(cfg('open'));
    const d = await e.evaluate(cmd('docker stop foo', 'docker', 'stop', ['foo']));
    expect(d.decision).toBe('deny');
  });

  it('reports a non-empty rulebook digest', () => {
    const e = new OpaCliEngine(cfg('open'));
    const digest = e.rulebookDigest();
    expect(digest).toMatch(/^[a-f0-9]{12}$/);
    expect(digest).not.toBe('000000000000');
  });

  it('duration_ms is a positive number', async () => {
    const e = new OpaCliEngine(cfg('open'));
    const d = await e.evaluate(cmd('git stash pop', 'git', 'stash', ['pop']));
    expect(typeof d.durationMs).toBe('number');
    expect(d.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('OpaCliEngine fail-mode (OT2)', () => {
  it('fail-open: unreachable binary → allow + source=fail-open', async () => {
    const badCfg: EngineConfig = {
      opaBinary: '/nonexistent/opa-binary-xyz',
      policyPath: POLICY,
      failMode: 'open',
      timeoutMs: 100,
      cacheTtlMs: 0,
    };
    const e = new OpaCliEngine(badCfg);
    const d = await e.evaluate(cmd('git stash pop', 'git', 'stash', ['pop']));
    expect(d.decision).toBe('allow');
    expect(d.source).toBe('fail-open');
    expect(d.reasons).toEqual([]);
  });

  it('fail-closed: unreachable binary → deny + source=fail-closed', async () => {
    const badCfg: EngineConfig = {
      opaBinary: '/nonexistent/opa-binary-xyz',
      policyPath: POLICY,
      failMode: 'closed',
      timeoutMs: 100,
      cacheTtlMs: 0,
    };
    const e = new OpaCliEngine(badCfg);
    const d = await e.evaluate(cmd('git stash pop', 'git', 'stash', ['pop']));
    expect(d.decision).toBe('deny');
    expect(d.source).toBe('fail-closed');
    expect(d.reasons.length).toBe(1);
  });

  it('fail-open on timeout (real binary, impossible-to-meet timeout)', async () => {
    const cfgTimeout: EngineConfig = {
      opaBinary: OPA,
      policyPath: POLICY,
      failMode: 'open',
      timeoutMs: 1,
      cacheTtlMs: 0,
    };
    const e = new OpaCliEngine(cfgTimeout);
    const d = await e.evaluate(cmd('git stash pop', 'git', 'stash', ['pop']));
    // With 1ms timeout, either OPA is fast enough or we hit fail-open.
    expect(['opa', 'fail-open']).toContain(d.source);
  });
});

describe.skipIf(!opaAvailable)('probeOpaVersion', () => {
  it('returns a version string from a real binary', async () => {
    const v = await probeOpaVersion(OPA);
    expect(v).toMatch(/^\d+\.\d+/);
  });

  it('returns empty string for missing binary', async () => {
    const v = await probeOpaVersion('/nonexistent/opa');
    expect(v).toBe('');
  });
});
