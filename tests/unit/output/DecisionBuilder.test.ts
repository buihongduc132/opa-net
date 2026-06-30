import { describe, expect, it } from 'bun:test';
import type { EngineConfig } from '../../../src/config/Config.ts';
import type { EngineDecision } from '../../../src/engine/types.ts';
import { DecisionBuilder, type DecisionOutput } from '../../../src/output/DecisionBuilder.ts';
import {
  OutputFormatter,
  isValidDecision,
  validateDecision,
} from '../../../src/output/OutputFormatter.ts';
import type { ParsedCommand } from '../../../src/parser/types.ts';
import { RULES, RuleRegistry } from '../../../src/rules/index.ts';

const FIXED_NOW = new Date('2026-07-01T14:23:45.123Z');
const FIXED_UUID = '7f3a9c2e-1b4d-4e8f-9a2c-5d6e7f8a9b01';

const cfg: EngineConfig = {
  policyPath: '/home/bhd/.pi/opa/safety.rego',
  failMode: 'open',
  timeoutMs: 250,
  cacheTtlMs: 0,
  hostname: 'bhd-main',
  sessionId: 'ses_abc123',
};

const builder = new DecisionBuilder({
  config: cfg,
  registry: new RuleRegistry(RULES),
  digest: 'dee3746bf7b5',
  now: () => FIXED_NOW,
  uuid: () => FIXED_UUID,
});

function parsed(
  raw: string,
  program: string,
  subcommand: string,
  args: string[] = [],
): ParsedCommand {
  return { raw, program, subcommand, args, parseConfidence: 'full' };
}

describe('DecisionBuilder — deny', () => {
  const denyEngine: EngineDecision = {
    decision: 'deny',
    source: 'opa',
    reasons: [{ message: 'Do not mutate stashes in shared work. Others may be relying on them.' }],
    opaVersion: '1.18.1',
    durationMs: 4.2,
  };

  it('builds a schema-valid deny record', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(() => validateDecision(out)).not.toThrow();
  });

  it('maps message → rule_id + family (provenance D3)', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.reasons[0].rule_id).toBe('block-git-stash-mutations');
    expect(out.reasons[0].family).toBe('git');
    expect(out.reasons[0].severity).toBe('block');
  });

  it('action=block on deny', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.action).toBe('block');
  });

  it('summary references the rule', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.summary).toBe('BLOCKED: git stash pop (rule: block-git-stash-mutations)');
  });

  it('collects suggestions from registered rules', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.suggestions).toContain('git stash list');
    expect(out.suggestions).toContain('git stash show');
  });

  it('echoes parsed input with parse_confidence', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.input.raw).toBe('git stash pop');
    expect(out.input.parse_confidence).toBe('full');
    expect(out.input.args).toEqual(['pop']);
  });

  it('metadata carries engine/digest/hostname/session', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.metadata.engine).toBe('opa');
    expect(out.metadata.rulebook_digest).toBe('dee3746bf7b5');
    expect(out.metadata.hostname).toBe('bhd-main');
    expect(out.metadata.session_id).toBe('ses_abc123');
    expect(out.metadata.opa_version).toBe('1.18.1');
  });

  it('uses injected now + uuid for determinism', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    expect(out.evaluated_at).toBe('2026-07-01T14:23:45.123Z');
    expect(out.decision_id).toBe(FIXED_UUID);
  });
});

describe('DecisionBuilder — allow', () => {
  const allowEngine: EngineDecision = {
    decision: 'allow',
    source: 'opa',
    reasons: [],
    opaVersion: '1.18.1',
    durationMs: 3.8,
  };

  it('reasons empty, action allow, summary empty', () => {
    const out = builder.build(parsed('git stash list', 'git', 'stash', ['list']), allowEngine);
    expect(out.reasons).toEqual([]);
    expect(out.action).toBe('allow');
    expect(out.summary).toBe('');
    expect(() => validateDecision(out)).not.toThrow();
  });
});

describe('DecisionBuilder — bare stash (builtin family)', () => {
  const bareEngine: EngineDecision = {
    decision: 'deny',
    source: 'opa',
    reasons: [
      { message: 'Bare `git stash` defaults to push. Use `git stash list/show` explicitly.' },
    ],
    opaVersion: '1.18.1',
    durationMs: 4.0,
  };

  it('resolves builtin:bare-stash-default with suggestions', () => {
    const out = builder.build(parsed('git stash', 'git', ''), bareEngine);
    expect(out.reasons[0].rule_id).toBe('builtin:bare-stash-default');
    expect(out.reasons[0].family).toBe('builtin');
    expect(out.suggestions).toContain('git stash branch <name>');
  });
});

describe('DecisionBuilder — fail-open', () => {
  const failOpenEngine: EngineDecision = {
    decision: 'allow',
    source: 'fail-open',
    reasons: [],
    opaVersion: '',
    durationMs: 250.0,
  };

  it('surfaces fail-open in summary + source', () => {
    const out = builder.build(
      parsed('git push origin main', 'git', 'push', ['origin', 'main']),
      failOpenEngine,
    );
    expect(out.source).toBe('fail-open');
    expect(out.summary).toMatch(/ALLOWED \(fail-open/);
    expect(out.metadata.opa_version).toBe('');
    expect(() => validateDecision(out)).not.toThrow();
  });
});

describe('DecisionBuilder — gcloud sprintf rule (program-inferred family)', () => {
  const gcloudEngine: EngineDecision = {
    decision: 'deny',
    source: 'opa',
    reasons: [{ message: "Mutation-capable gcloud operation 'delete' is blocked by default." }],
    opaVersion: '1.18.1',
    durationMs: 4.0,
  };

  it('synthesizes custom rule_id but infers family=gcloud', () => {
    const out = builder.build(
      parsed('gcloud compute instances delete x', 'gcloud', 'delete'),
      gcloudEngine,
    );
    expect(out.reasons[0].family).toBe('gcloud');
    expect(out.reasons[0].rule_id).toMatch(/^custom:/);
    expect(() => validateDecision(out)).not.toThrow();
  });
});

describe('OutputFormatter', () => {
  const fmt = new OutputFormatter();
  const denyEngine: EngineDecision = {
    decision: 'deny',
    source: 'opa',
    reasons: [{ message: 'Do not mutate stashes in shared work. Others may be relying on them.' }],
    opaVersion: '1.18.1',
    durationMs: 4.2,
  };
  const allowEngine: EngineDecision = {
    decision: 'allow',
    source: 'opa',
    reasons: [],
    opaVersion: '1.18.1',
    durationMs: 3.8,
  };

  it('json mode: deny → exit 2 + JSON on stdout', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    const r = fmt.format(out, 'json');
    expect(r.exitCode).toBe(2);
    const obj = JSON.parse(r.stdout);
    expect(obj.decision).toBe('deny');
  });

  it('json mode: allow → exit 0 + JSON on stdout', () => {
    const out = builder.build(parsed('git stash list', 'git', 'stash', ['list']), allowEngine);
    const r = fmt.format(out, 'json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.decision).toBe('allow');
  });

  it('claude-code mode: deny → exit 2 + JSON on stdout', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine);
    const r = fmt.format(out, 'claude-code');
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.stdout).decision).toBe('deny');
  });

  it('claude-code mode: allow → exit 0 + EMPTY stdout (CA2)', () => {
    const out = builder.build(parsed('git stash list', 'git', 'stash', ['list']), allowEngine);
    const r = fmt.format(out, 'claude-code');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('isValidDecision', () => {
  it('returns true for a valid record', () => {
    const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), {
      decision: 'deny',
      source: 'opa',
      reasons: [
        { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
      ],
      opaVersion: '1.18.1',
      durationMs: 4.2,
    });
    expect(isValidDecision(out)).toBe(true);
  });

  it('returns false for a record missing required fields', () => {
    // intentionally malformed — missing schema_version, wrong types
    const bad = { decision: 'maybe' } as unknown as DecisionOutput;
    expect(isValidDecision(bad)).toBe(false);
  });

  it('validateDecision throws on invalid record', () => {
    const bad = { decision: 'maybe' } as unknown as DecisionOutput;
    expect(() => validateDecision(bad)).toThrow();
  });
});
