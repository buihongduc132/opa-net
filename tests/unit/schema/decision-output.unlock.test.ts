import { describe, expect, it } from 'bun:test';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../schemas/decision-output.v1.json' with { type: 'json' };

/**
 * Schema additive tests for rule-unlock-keys.
 * These tests verify the schema has been extended with unlock fields while
 * preserving additionalProperties:false at every level.
 */
describe('decision-output.v1 — unlock additive fields', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  function baseDecision(overrides: Record<string, any> = {}): Record<string, any> {
    return {
      schema_version: '1.0',
      decision: 'allow',
      action: 'allow',
      source: 'opa',
      reasons: [],
      input: {
        raw: 'git stash pop',
        program: 'git',
        subcommand: 'stash',
        args: ['pop'],
        parse_confidence: 'full',
      },
      summary: '',
      suggestions: [],
      metadata: {
        engine: 'opa',
        opa_version: '1.18.1',
        rulebook_digest: 'dee3746bf7b5',
        policy_path: '/home/agent/.pi/opa/safety.rego',
        hostname: 'dev-box',
        session_id: 'ses_abc123',
      },
      evaluated_at: '2026-07-01T14:23:45.123Z',
      decision_id: '7f3a9c2e-1b4d-4e8f-9a2c-5d6e7f8a9b01',
      duration_ms: 4.2,
      ...overrides,
    };
  }

  describe('new source enum values', () => {
    it('accepts source=opa-unlocked', () => {
      const rec = baseDecision({ source: 'opa-unlocked' });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts source=fail-open-keyless', () => {
      const rec = baseDecision({ source: 'fail-open-keyless' });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts source=unlock-filter-error', () => {
      const rec = baseDecision({ source: 'unlock-filter-error' });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });
  });

  describe('reasons[] additive unlock fields', () => {
    it('accepts bypassed=true on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            bypassed: true,
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_key_id (8 hex) on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_key_id: 'a3f9c2b8',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_key_type=ll on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_key_type: 'll',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_key_type=ttl on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_key_type: 'ttl',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_expires_at (ISO date-time) on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_expires_at: '2026-07-20T15:00:00.000Z',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_status=valid on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_status: 'valid',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_status=expired on a reason', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_status: 'expired',
          },
        ],
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });
  });

  describe('metadata additive unlock fields', () => {
    it('accepts unlock_count on metadata', () => {
      const rec = baseDecision({
        metadata: {
          engine: 'opa',
          opa_version: '1.18.1',
          rulebook_digest: 'dee3746bf7b5',
          policy_path: '/home/agent/.pi/opa/safety.rego',
          hostname: 'dev-box',
          session_id: 'ses_abc123',
          unlock_count: 1,
        },
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_blocked_count on metadata', () => {
      const rec = baseDecision({
        metadata: {
          engine: 'opa',
          opa_version: '1.18.1',
          rulebook_digest: 'dee3746bf7b5',
          policy_path: '/home/agent/.pi/opa/safety.rego',
          hostname: 'dev-box',
          session_id: 'ses_abc123',
          unlock_blocked_count: 0,
        },
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });

    it('accepts unlock_agent on metadata', () => {
      const rec = baseDecision({
        metadata: {
          engine: 'opa',
          opa_version: '1.18.1',
          rulebook_digest: 'dee3746bf7b5',
          policy_path: '/home/agent/.pi/opa/safety.rego',
          hostname: 'dev-box',
          session_id: 'ses_abc123',
          unlock_agent: 'deploy-bot-7',
        },
      });
      const ok = validate(rec);
      expect(ok, `errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    });
  });

  describe('additionalProperties:false preserved', () => {
    it('rejects unknown fields on the top-level decision', () => {
      const rec = baseDecision({ evil_field: true });
      const ok = validate(rec);
      expect(ok).toBe(false);
    });

    it('rejects unknown fields on reasons[]', () => {
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            evil_field: true,
          },
        ],
      });
      const ok = validate(rec);
      expect(ok).toBe(false);
    });

    it('rejects unknown fields on input', () => {
      const rec = baseDecision({
        input: {
          raw: 'git stash pop',
          program: 'git',
          subcommand: 'stash',
          args: ['pop'],
          parse_confidence: 'full',
          evil_field: true,
        },
      });
      const ok = validate(rec);
      expect(ok).toBe(false);
    });

    it('rejects unknown fields on metadata', () => {
      const rec = baseDecision({
        metadata: {
          engine: 'opa',
          opa_version: '1.18.1',
          rulebook_digest: 'dee3746bf7b5',
          policy_path: '/home/agent/.pi/opa/safety.rego',
          hostname: 'dev-box',
          session_id: 'ses_abc123',
          evil_field: true,
        },
      });
      const ok = validate(rec);
      expect(ok).toBe(false);
    });
  });

  describe('full key never appears', () => {
    it('unlock_key_id is exactly 8 hex chars (not 16)', () => {
      // Schema should enforce 8-hex pattern, not allow 16-hex (full key).
      const rec = baseDecision({
        reasons: [
          {
            rule_id: 'block-git-stash-mutations',
            message: 'Do not mutate stashes in shared work.',
            family: 'git',
            severity: 'block',
            unlock_key_id: 'a3f9c2b8e1d4abcd', // 16 hex — should be rejected
          },
        ],
      });
      const ok = validate(rec);
      expect(ok).toBe(false);
    });
  });
});
