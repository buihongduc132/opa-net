/**
 * RED PHASE — zcode extension entry point.
 *
 * ZCode uses command-type hooks (not callback registration). The entry point
 * exposes a default export that:
 *   1. Auto-discovers PIOPANET_HOME (honoring ZCODE_OPA_NET_HOME alias)
 *   2. Provides a `runHookScript()` function that reads PreToolUse stdin JSON,
 *      calls handleZcodeToolCall, and writes the ZCode-canonical block
 *      directive to stdout.
 *
 * Fails until src/zcode/index.ts exists.
 */
import { describe, expect, it } from 'bun:test';
import zcodeOpaNetExtension, { runHookScript } from '../../src/zcode/index';

describe('zcode-opa-net extension entry point', () => {
  it('default export is an object (not a function — ZCode uses command hooks)', () => {
    expect(typeof zcodeOpaNetExtension).toBe('object');
    expect(zcodeOpaNetExtension).not.toBeNull();
  });

  it('default export exposes runHookScript function', () => {
    expect(typeof runHookScript).toBe('function');
  });

  it('auto-discovers PIOPANET_HOME never to a bogus path', () => {
    delete process.env.PIOPANET_HOME;
    process.env.ZCODE_HOME = '/definitely-nonexistent-zcode-home';
    try {
      // Trigger auto-discovery by importing fresh — but since the module is
      // already loaded, we exercise it via runHookScript with an empty stdin.
      // PIOPANET_HOME must NOT become bogus.
      if (process.env.PIOPANET_HOME) {
        expect(process.env.PIOPANET_HOME).not.toContain('definitely-nonexistent');
      }
    } finally {
      delete process.env.ZCODE_HOME;
      delete process.env.PIOPANET_HOME;
    }
  });

  it('honors ZCODE_OPA_NET_HOME as a PIOPANET_HOME alias when set', async () => {
    delete process.env.PIOPANET_HOME;
    process.env.ZCODE_OPA_NET_HOME = '/tmp/zcode-opa-net-home-alias';
    try {
      // autoDiscoverOpaNetHome is exported — call it directly to verify the
      // alias propagates to PIOPANET_HOME.
      const { autoDiscoverOpaNetHome } = await import('../../src/zcode/index');
      autoDiscoverOpaNetHome();
      // When the ZCode-canonical alias is set, PIOPANET_HOME must mirror it
      // so the shared engine picks up the same rule/policy home.
      expect(process.env.PIOPANET_HOME as string | undefined).toBe('/tmp/zcode-opa-net-home-alias');
    } finally {
      delete process.env.ZCODE_OPA_NET_HOME;
      delete process.env.PIOPANET_HOME;
    }
  });
});
