import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DecisionOutput } from '../output/DecisionBuilder.ts';
import { type AuditSink, createFilesystemAuditSink, writeAuditEntry } from './audit.ts';

/** Fail-closed block reason — mirrors pi-safety-net's REASON_SAFETY_NET_FAILED_CLOSED. */
export const REASON_OPA_NET_FAILED_CLOSED =
  'OPA-Net fail-closed: command evaluation failed unexpectedly.';

/** Reason prefix for malformed shell tool input. */
const REASON_MALFORMED_SHELL_INPUT =
  'OPA-Net fail-closed: shell tool call input missing required command field.';

type PiApi = {
  on: (
    event: 'tool_call',
    handler: (event: unknown, ctx: PiToolCallContext) => Promise<PiToolCallResult>,
  ) => void;
};

export type EvalOpts = { cwd?: string; env?: NodeJS.ProcessEnv };

export type PiToolCallContext = {
  cwd: string;
  sessionManager: {
    getSessionFile: () => string | undefined;
  };
  /**
   * Inject-able eval function. Unit tests pass a stub. Production wires this
   * to the real `bin/pi-opa-net.js eval` subprocess.
   */
  opaNetEvalCommand?: (command: string, opts?: EvalOpts) => Promise<DecisionOutput>;
  /** Optional audit sink for test capture. Production wires filesystem sink. */
  auditSink?: AuditSink;
  /** Reserved for future config passthrough. */
  opaNetConfigOptions?: Record<string, unknown>;
};

export type PiToolCallResult = { block: true; reason: string } | undefined;

type PiToolCallEvent = {
  type?: string;
  toolName?: string;
  input?: Record<string, unknown>;
};

type PiShellToolAdapter = {
  commandField: string;
  cwdField?: string;
};

const PI_SHELL_TOOL_ADAPTERS: Partial<Record<string, PiShellToolAdapter>> = {
  bash: { commandField: 'command' },
  Shell: { commandField: 'command', cwdField: 'working_directory' },
};

type PiShellToolCall = { command: string; cwd: string } | { malformed: true };

export function registerToolCallEvent(pi: PiApi): void {
  pi.on('tool_call', handlePiToolCall);
}

function isStrictMode(): boolean {
  return process.env.PIOPANET_STRICT === '1';
}

/**
 * Default subprocess eval — spawns `bin/pi-opa-net.js eval "<cmd>" --json`
 * and parses stdout as DecisionOutput. This is the production bridge:
 * without this, the handler has no way to evaluate commands.
 *
 * Mirrors pi-safety-net's `?? analyzeCommand` default.
 */
async function defaultEvalCommand(command: string, opts?: EvalOpts): Promise<DecisionOutput> {
  const binPath = resolve(fileURLToPath(import.meta.url), '../../../bin/pi-opa-net.js');
  const cwd = opts?.cwd ?? process.cwd();

  return new Promise((accept, reject) => {
    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      cwd,
      env: opts?.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code !== 0 && code !== 2) {
        // Exit code 0 = allow, 2 = deny. Anything else = subprocess error.
        reject(new Error(`pi-opa-net eval exited ${code}: ${stderr}`));
        return;
      }
      try {
        const decision = JSON.parse(stdout.trim()) as DecisionOutput;
        accept(decision);
      } catch (err) {
        reject(
          new Error(`pi-opa-net eval non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`),
        );
      }
    });
  });
}

/** @internal — exported for test coverage */
export async function handlePiToolCall(
  event: unknown,
  ctx: PiToolCallContext,
): Promise<PiToolCallResult> {
  const shellToolCall = getPiShellToolCall(event, ctx);
  if (!shellToolCall) return undefined;

  if ('malformed' in shellToolCall) {
    return blockPiToolCall(REASON_MALFORMED_SHELL_INPUT);
  }

  const { command, cwd } = shellToolCall;

  // Use injected eval OR default subprocess eval.
  const evalCommand = ctx.opaNetEvalCommand ?? defaultEvalCommand;

  let decision: DecisionOutput;
  try {
    decision = await evalCommand(command, { cwd });
  } catch {
    // Fork fail-open default: do not brick the agent on eval errors.
    if (isStrictMode()) {
      return blockPiToolCall(REASON_OPA_NET_FAILED_CLOSED, command);
    }
    return undefined;
  }

  // Allow + log_only: proceed (with audit).
  // opa-unlocked: engine already filtered — plugin trusts it.
  // fail-open / cached: degraded paths — proceed silently.
  if (
    decision.decision === 'allow' ||
    decision.action === 'allow' ||
    decision.action === 'log_only'
  ) {
    return undefined;
  }

  // Deny + block: translate + audit + block.
  if (decision.decision === 'deny' && decision.action === 'block') {
    const sessionId = ctx.sessionManager.getSessionFile();
    if (sessionId) {
      const auditSink = ctx.auditSink ?? createFilesystemAuditSink(cwd);
      await writeAuditEntry({
        sessionId,
        decision,
        auditSink,
      });
    }
    return blockPiToolCall(formatBlockReason(decision), command);
  }

  // prompt_user (reserved v2) — treat as allow for now.
  return undefined;
}

function getPiShellToolCall(event: unknown, ctx: PiToolCallContext): PiShellToolCall | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const toolCall = event as PiToolCallEvent;
  if (typeof toolCall.toolName !== 'string') return undefined;

  const adapter = PI_SHELL_TOOL_ADAPTERS[toolCall.toolName];
  if (!adapter) return undefined;
  if (!toolCall.input || typeof toolCall.input !== 'object') return { malformed: true };

  const command = toolCall.input[adapter.commandField];
  if (typeof command !== 'string') return { malformed: true };

  const cwdInput = adapter.cwdField ? toolCall.input[adapter.cwdField] : undefined;
  const cwd = typeof cwdInput === 'string' ? resolve(ctx.cwd, cwdInput) : ctx.cwd;
  return { command, cwd };
}

function formatBlockReason(decision: DecisionOutput): string {
  const reasons = decision.reasons.map((r) => `${r.rule_id}: ${r.message}`).join('; ');
  const header = decision.summary || 'BLOCKED by OPA-Net';
  return `${header}\nReason: ${reasons}\nRule family: ${decision.reasons[0]?.family ?? 'unknown'}`;
}

function blockPiToolCall(reason: string, _command?: string): PiToolCallResult {
  return { block: true, reason };
}
