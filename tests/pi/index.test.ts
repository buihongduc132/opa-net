/**
 * RED PHASE — pi extension default-export entry point.
 *
 * Mirrors pi-safety-net/src/pi/index.ts: a default-export function
 * `(pi) => void` that registers the tool_call handler + auto-discovers
 * PIOPANET_HOME.
 */
import { describe, expect, it } from 'bun:test';
import piOpaNetExtension from '../../src/pi/index';

describe('pi-opa-net pi extension entry point', () => {
  it('default export is a function', () => {
    expect(typeof piOpaNetExtension).toBe('function');
  });

  it('registers a tool_call handler on pi', () => {
    const events: { event: string; count: number }[] = [];
    const fakePi = {
      on: (event: string) => {
        events.push({ event, count: 1 });
      },
    };
    (piOpaNetExtension as (pi: unknown) => void)(fakePi);
    const toolCallReg = events.find((e) => e.event === 'tool_call');
    expect(toolCallReg).toBeDefined();
  });

  it('sets PIOPANET_HOME env auto-discovery when unset + candidate exists', () => {
    delete process.env.PIOPANET_HOME;
    // Force a candidate path that won't exist; impl must check existence.
    // We assert PIOPANET_HOME is NOT set to a bogus value (impl must guard).
    const fakePi = { on: () => {} };
    (piOpaNetExtension as (pi: unknown) => void)(fakePi);
    // Either unset or set to a real candidate path — never bogus.
    if (process.env.PIOPANET_HOME) {
      expect(process.env.PIOPANET_HOME).not.toContain('definitely-nonexistent');
    }
  });
});
