/**
 * RED PHASE — hermes extension default-export entry point.
 *
 * Mirrors src/pi/index.ts but adapts to the Hermes plugin lifecycle:
 * a default-export `register(ctx)` function that subscribes to the
 * `pre_tool_call` hook (ctx.register_hook, per hermes_cli/plugins.py) and
 * auto-discovers PIOPANET_HOME (honoring the HERMES_OPA_NET_HOME alias).
 *
 * Fails until src/hermes/index.ts exists.
 */
import { describe, expect, it } from 'bun:test';
import hermesOpaNetExtension from '../../src/hermes/index';

describe('hermes-opa-net extension entry point', () => {
  it('default export is a function', () => {
    expect(typeof hermesOpaNetExtension).toBe('function');
  });

  it('registers a pre_tool_call handler on the Hermes plugin ctx', () => {
    const registered: { hook: string; count: number }[] = [];
    const fakeHermesCtx = {
      register_hook: (hook: string) => {
        registered.push({ hook, count: 1 });
      },
    };
    (hermesOpaNetExtension as (ctx: unknown) => void)(fakeHermesCtx);
    const preToolCall = registered.find((r) => r.hook === 'pre_tool_call');
    expect(preToolCall).toBeDefined();
  });

  it('sets PIOPANET_HOME env auto-discovery when unset (never to a bogus path)', () => {
    delete process.env.PIOPANET_HOME;
    // Force the candidate-resolution path to a non-existent agent dir so the
    // existence guard is exercised. PIOPANET_HOME must NOT become bogus.
    process.env.HERMES_HOME = '/definitely-nonexistent-hermes-home';
    const fakeHermesCtx = { register_hook: () => {} };
    try {
      (hermesOpaNetExtension as (ctx: unknown) => void)(fakeHermesCtx);
      if (process.env.PIOPANET_HOME) {
        expect(process.env.PIOPANET_HOME).not.toContain('definitely-nonexistent');
      }
    } finally {
      delete process.env.HERMES_HOME;
      delete process.env.PIOPANET_HOME;
    }
  });

  it('honors HERMES_OPA_NET_HOME as a PIOPANET_HOME alias when set', () => {
    delete process.env.PIOPANET_HOME;
    process.env.HERMES_OPA_NET_HOME = '/tmp/hermes-opa-net-home-alias';
    const fakeHermesCtx = { register_hook: () => {} };
    try {
      (hermesOpaNetExtension as (ctx: unknown) => void)(fakeHermesCtx);
      // When the Hermes-canonical alias is set, PIOPANET_HOME must mirror it
      // so the shared engine picks up the same rule/policy home.
      const home: string | undefined = process.env.PIOPANET_HOME;
      expect(home === '/tmp/hermes-opa-net-home-alias').toBe(true);
    } finally {
      delete process.env.HERMES_OPA_NET_HOME;
      delete process.env.PIOPANET_HOME;
    }
  });
});
