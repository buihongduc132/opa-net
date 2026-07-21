import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { registerToolCallEvent } from './tool-call.ts';

type PiExtensionApi = Parameters<typeof registerToolCallEvent>[0];

/**
 * Auto-discover the rule/policy config shipped alongside the pi agent.
 *
 * Mirrors pi-safety-net/src/pi/index.ts: derives agent dir from PI_CODING_AGENT_DIR
 * or PI_SESSION_FILE (sessions/ parent), checks for a `<agentDir>/pi-opa-net/rules/`
 * candidate, and sets PIOPANET_HOME so the engine picks it up zero-config.
 */
function autoDiscoverOpaNetHome(): void {
  if (process.env.PIOPANET_HOME) return;
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ||
    (process.env.PI_SESSION_FILE && dirname(dirname(process.env.PI_SESSION_FILE)));
  if (!agentDir) return;
  const candidate = join(agentDir, 'pi-opa-net');
  if (existsSync(join(candidate, 'rules'))) {
    process.env.PIOPANET_HOME = candidate;
  }
}

export default function piOpaNetExtension(pi: PiExtensionApi): void {
  autoDiscoverOpaNetHome();
  registerToolCallEvent(pi);
}

// Re-export for direct unit-test access.
export { handlePiToolCall, registerToolCallEvent } from './tool-call.ts';
export type { PiToolCallContext, PiToolCallResult } from './tool-call.ts';
