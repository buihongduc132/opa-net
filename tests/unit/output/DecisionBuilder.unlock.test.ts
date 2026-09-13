import { describe, expect, it } from 'bun:test';
import type { EngineConfig } from '../../../src/config/Config.ts';
import type { EngineDecision } from '../../../src/engine/types.ts';
import { DecisionBuilder } from '../../../src/output/DecisionBuilder.ts';
import type { ParsedCommand } from '../../../src/parser/types.ts';
import { RULES, RuleRegistry } from '../../../src/rules/index.ts';
import type { UnlockResult } from '../../../src/unlock/types.ts';

const FIXED_NOW = new Date('2026-07-01T14:23:45.123Z');
const FIXED_UUID = '7f3a9c2e-1b4d-4e8f-9a2c-5d6e7f8a9b01';

const cfg: EngineConfig = {
  policyPath: '/home/agent/.pi/opa/safety.rego',
  failMode: 'open',
  timeoutMs: 250,
  cacheTtlMs: 0,
  hostname: 'dev-box',
  sessionId: 'ses_abc123',
} as EngineConfig;

function parsed(
  raw: string,
  program: string,
  subcommand: string,
  args: string[] = [],
): ParsedCommand {
  return { raw, program, subcommand, args, parseConfidence: 'full' };
}

function makeUnlockResult(
  bypassedCount: number,
  blockedCount: number,
  reasons: any[],
): UnlockResult {
  return {
    allow: blockedCount === 0,
    bypassedCount,
    blockedCount,
    reasons,
  };
}

describe('DecisionBuilder — unlock integration', () => {
  const denyEngine: EngineDecision = {
    decision: 'deny',
    source: 'opa',
    reasons: [{ message: 'Do not mutate stashes in shared work. Others may be relying on them.' }],
    opaVersion: '1.18.1',
    durationMs: 4.2,
  };

  describe('source override to opa-unlocked', () => {
    it('sets source=opa-unlocked when unlockResult.bypassedCount > 0 and blockedCount=0', () => {
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(1, 0, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll' as const,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.source).toBe('opa-unlocked');
      expect(out.decision).toBe('allow');
    });
  });

  describe('metadata.unlock_count + unlock_blocked_count', () => {
    it('populates unlock_count and unlock_blocked_count', () => {
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(1, 0, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll' as const,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.metadata.unlock_count).toBe(1);
      expect(out.metadata.unlock_blocked_count).toBe(0);
    });

    it('populates unlock_blocked_count when partial bypass', () => {
      const multiDenyEngine: EngineDecision = {
        decision: 'deny',
        source: 'opa',
        reasons: [
          { message: 'Do not mutate stashes in shared work. Others may be relying on them.' },
          { message: "Hard reset discards local work and can remove others' uncommitted changes." },
        ],
        opaVersion: '1.18.1',
        durationMs: 4.2,
      };
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(1, 1, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll' as const,
        },
        {
          message: "Hard reset discards local work and can remove others' uncommitted changes.",
          ruleId: 'block-git-reset-hard',
          bypassed: false,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), multiDenyEngine, {
        unlockResult,
      });
      expect(out.metadata.unlock_blocked_count).toBe(1);
      expect(out.decision).toBe('deny');
    });
  });

  describe('TTL reason has unlock_expires_at', () => {
    it('includes unlock_expires_at for TTL-bypassed reasons', () => {
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const unlockResult = makeUnlockResult(1, 0, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'ttl' as const,
          expiresAt: exp,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.reasons[0].unlock_key_type).toBe('ttl');
      expect(out.reasons[0].unlock_expires_at).toBeDefined();
    });
  });

  describe('expired TTL → unlock_status=expired, severity stays block', () => {
    it('records unlock_status=expired for expired TTL keys', () => {
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(0, 1, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: false,
          unlockStatus: 'expired' as const,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.reasons[0].unlock_status).toBe('expired');
      expect(out.reasons[0].severity).toBe('block');
      expect(out.decision).toBe('deny');
    });
  });

  describe('reasons[].bypassed reflected', () => {
    it('bypassed=true reflects in the output reasons', () => {
      const builder = new DecisionBuilder({
        config: cfg,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(1, 0, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll' as const,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.reasons[0].bypassed).toBe(true);
      expect(out.reasons[0].unlock_key_id).toBe('a3f9c2b8');
    });
  });

  describe('unlock_agent in metadata', () => {
    it('populates unlock_agent from config', () => {
      const cfgWithAgent = { ...cfg, unlockAgentId: 'deploy-bot-7' } as EngineConfig;
      const builder = new DecisionBuilder({
        config: cfgWithAgent,
        registry: new RuleRegistry(RULES),
        digest: 'dee3746bf7b5',
        now: () => FIXED_NOW,
        uuid: () => FIXED_UUID,
      });
      const unlockResult = makeUnlockResult(1, 0, [
        {
          message: 'Do not mutate stashes in shared work. Others may be relying on them.',
          ruleId: 'block-git-stash-mutations',
          bypassed: true,
          unlockKeyId: 'a3f9c2b8',
          keyType: 'll' as const,
        },
      ]);
      const out = builder.build(parsed('git stash pop', 'git', 'stash', ['pop']), denyEngine, {
        unlockResult,
      });
      expect(out.metadata.unlock_agent).toBe('deploy-bot-7');
    });
  });
});
