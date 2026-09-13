import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type ZcodeToolCallContext, handleZcodeToolCall } from './tool-call.ts';

/**
 * Auto-discover the rule/policy config for the ZCode agent.
 *
 * Priority:
 *   1. ZCODE_OPA_NET_HOME env alias → PIOPANET_HOME (always honored if set)
 *   2. ZCODE_HOME env → check for <ZCODE_HOME>/opa-net/rules/ existence
 *      → set PIOPANET_HOME only if candidate exists (never bogus)
 *
 * Mirrors src/hermes/index.ts autoDiscoverOpaNetHome but adapted for ZCode.
 */
export function autoDiscoverOpaNetHome(): void {
  // Honor explicit alias first (no existence check — user explicitly set it).
  const alias = process.env.ZCODE_OPA_NET_HOME;
  if (alias) {
    process.env.PIOPANET_HOME = alias;
    return;
  }

  if (process.env.PIOPANET_HOME) return;

  // Auto-discover from ZCODE_HOME.
  const zcodeHome = process.env.ZCODE_HOME;
  if (!zcodeHome) return;

  const candidate = join(zcodeHome, 'opa-net');
  if (existsSync(join(candidate, 'rules'))) {
    process.env.PIOPANET_HOME = candidate;
  }
}

/**
 * Build the ZCode tool-call context from process state.
 * cwd from process.cwd(); sessionManager reads ZCODE_SESSION_FILE env.
 */
function buildContext(): ZcodeToolCallContext {
  return {
    cwd: process.cwd(),
    sessionManager: {
      getSessionFile: () => process.env.ZCODE_SESSION_FILE,
    },
  };
}

/**
 * Run the ZCode PreToolUse hook script.
 *
 * ZCode dispatches command-type hooks by spawning the hook command and piping
 * a JSON payload on stdin. This function:
 *   1. Reads stdin (the PreToolUse payload)
 *   2. Calls handleZcodeToolCall(payload, ctx)
 *   3. Writes the result JSON to stdout (or {} on allow / error)
 *
 * Failure isolation: on ANY error, emit {} (never block the turn, never emit
 * invalid JSON). Mirrors ZCode's own hook conventions.
 */
export async function runHookScript(): Promise<void> {
  autoDiscoverOpaNetHome();

  let payload: Record<string, unknown> = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw) {
      payload = JSON.parse(raw);
    }
  } catch {
    // Malformed stdin — emit {} and let the tool call proceed.
    process.stdout.write('{}');
    return;
  }

  try {
    const result = await handleZcodeToolCall(payload, buildContext());
    process.stdout.write(result ? JSON.stringify(result) : '{}');
  } catch {
    // Failure isolation — never break the agent turn.
    process.stdout.write('{}');
  }
}

// Default export: object (ZCode uses command hooks, not callback registration).
export default {
  runHookScript,
  autoDiscoverOpaNetHome,
};

// Re-export for direct unit-test access.
export { handleZcodeToolCall } from './tool-call.ts';
export type { ZcodeToolCallContext, ZcodeToolCallResult } from './tool-call.ts';
