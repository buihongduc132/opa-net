import { afterEach, describe, expect, it } from 'bun:test';
import { configFromEnv } from '../../../src/config/Config.ts';

describe('Config.unlock', () => {
  afterEach(() => {
    delete process.env.PIOPANET_UNLOCK_KEYS;
    delete process.env.PIOPANET_UNLOCK_SALT;
    delete process.env.PIOPANET_UNLOCK_SALT_FILE;
    delete process.env.PIOPANET_AGENT_ID;
    delete process.env.PI_OPA_CACHE_TTL_MS;
  });

  describe('PIOPANET_UNLOCK_KEYS', () => {
    it('parses comma-separated unlock keys', () => {
      process.env.PIOPANET_UNLOCK_KEYS = 'll_aaa,ttl.123.bbb,ll_ccc';
      const config = configFromEnv('/p.rego');
      expect(config.unlockKeys).toEqual(['ll_aaa', 'ttl.123.bbb', 'll_ccc']);
    });

    it('returns empty array when env not set', () => {
      const config = configFromEnv('/p.rego');
      expect(config.unlockKeys).toEqual([]);
    });

    it('handles single key', () => {
      process.env.PIOPANET_UNLOCK_KEYS = 'll_aaa';
      const config = configFromEnv('/p.rego');
      expect(config.unlockKeys).toEqual(['ll_aaa']);
    });

    it('trims whitespace from keys', () => {
      process.env.PIOPANET_UNLOCK_KEYS = ' ll_aaa , ttl.123.bbb ';
      const config = configFromEnv('/p.rego');
      expect(config.unlockKeys).toEqual(['ll_aaa', 'ttl.123.bbb']);
    });
  });

  describe('PIOPANET_UNLOCK_SALT', () => {
    it('reads salt path from env', () => {
      process.env.PIOPANET_UNLOCK_SALT = '/custom/salt/path';
      const config = configFromEnv('/p.rego');
      expect(config.unlockSaltPath).toBe('/custom/salt/path');
    });

    it('defaults to ~/.pi-opa-net/salt when not set', () => {
      const config = configFromEnv('/p.rego');
      expect(config.unlockSaltPath).toContain('.pi-opa-net');
      expect(config.unlockSaltPath).toContain('salt');
    });
  });

  describe('PIOPANET_UNLOCK_SALT_FILE', () => {
    it('reads salt file path from env (alternative to PIOPANET_UNLOCK_SALT)', () => {
      process.env.PIOPANET_UNLOCK_SALT_FILE = '/alt/salt/file';
      const config = configFromEnv('/p.rego');
      expect(config.unlockSaltPath).toBe('/alt/salt/file');
    });
  });

  describe('PIOPANET_AGENT_ID', () => {
    it('reads agent ID from env', () => {
      process.env.PIOPANET_AGENT_ID = 'deploy-bot-7';
      const config = configFromEnv('/p.rego');
      expect(config.unlockAgentId).toBe('deploy-bot-7');
    });

    it('returns undefined when not set', () => {
      const config = configFromEnv('/p.rego');
      expect(config.unlockAgentId).toBeUndefined();
    });
  });

  describe('cacheTtlMs forced to 0 when keys present (LD-G3)', () => {
    it('forces cacheTtlMs=0 when unlock keys are present', () => {
      process.env.PI_OPA_CACHE_TTL_MS = '300';
      process.env.PIOPANET_UNLOCK_KEYS = 'll_aaa';
      const config = configFromEnv('/p.rego');
      expect(config.cacheTtlMs).toBe(0);
    });

    it('respects cacheTtlMs when no unlock keys present', () => {
      process.env.PI_OPA_CACHE_TTL_MS = '300';
      const config = configFromEnv('/p.rego');
      expect(config.cacheTtlMs).toBe(300);
    });

    it('forces cacheTtlMs=0 even when cacheTtlMs explicitly set to non-zero', () => {
      process.env.PI_OPA_CACHE_TTL_MS = '600';
      process.env.PIOPANET_UNLOCK_KEYS = 'ttl.123.bbb';
      const config = configFromEnv('/p.rego');
      expect(config.cacheTtlMs).toBe(0);
    });
  });
});
