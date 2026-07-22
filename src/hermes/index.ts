import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerPreToolCallHook } from './tool-call.ts';

type HermesPluginCtx = {
  register_hook: (hook: string, callback: (kwargs: Record<string, unknown>) => unknown) => void;
};

/**
 * Auto-discover the rule/policy config for the Hermes agent.
 *
 * Priority:
 *   1. HERMES_OPA_NET_HOME env alias → PIOPANET_HOME (always honored if set)
 *   2. HERMES_HOME env → check for <HERMES_HOME>/opa-net/rules/ existence
 *      → set PIOPANET_HOME only if candidate exists (never bogus)
 *
 * Mirrors src/pi/index.ts autoDiscoverOpaNetHome but adapted for Hermes.
 */
function autoDiscoverOpaNetHome(): void {
  // Honor explicit alias first (no existence check — user explicitly set it).
  const alias = process.env.HERMES_OPA_NET_HOME;
  if (alias) {
    process.env.PIOPANET_HOME = alias;
    return;
  }

  if (process.env.PIOPANET_HOME) return;

  // Auto-discover from HERMES_HOME.
  const hermesHome = process.env.HERMES_HOME;
  if (!hermesHome) return;

  const candidate = join(hermesHome, 'opa-net');
  if (existsSync(join(candidate, 'rules'))) {
    process.env.PIOPANET_HOME = candidate;
  }
}

export default function hermesOpaNetExtension(ctx: HermesPluginCtx): void {
  autoDiscoverOpaNetHome();
  registerPreToolCallHook(ctx);
}

// Re-export for direct unit-test access.
export { handleHermesToolCall, registerPreToolCallHook } from './tool-call.ts';
export type { HermesToolCallContext, HermesToolCallResult } from './tool-call.ts';
