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

export type EvalOpts = { cwd?: string; env?: NodeJS.ProcessEnv };

export type ZcodeToolCallContext = {
  cwd: string;
  sessionManager: {
    getSessionFile: () => string | undefined;
  };
  /**
   * Inject-able eval function. Unit tests pass a stub. Production wires this
   * to the real `bin/pi-opa-net.js eval` subprocess (shared engine CLI).
   */
  opaNetEvalCommand?: (command: string, opts?: EvalOpts) => Promise<DecisionOutput>;
  /** Optional audit sink for test capture. Production wires filesystem sink. */
  auditSink?: AuditSink;
  /** Reserved for future config passthrough. */
  opaNetConfigOptions?: Record<string, unknown>;
};

/**
 * ZCode-canonical block directive (verified against zcode.cjs bundle).
 * permissionDecision enum: "allow" | "ask" | "deny".
 */
export type ZcodeToolCallResult =
  | {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse';
        permissionDecision: 'deny';
        permissionDecisionReason: string;
      };
    }
  | undefined;

type ZcodePreToolUsePayload = {
  hookEventName?: string;
  toolName?: string;
  tool_name?: string;
  toolInput?: Record<string, unknown>;
  tool_input?: Record<string, unknown>;
};

/**
 * ZCode shell tool names. ZCode is Claude-Code-compatible, so the canonical
 * shell tool is "Bash" (capitalized). "terminal" is an alias.
 */
const ZCODE_SHELL_TOOL_NAMES = new Set(['Bash', 'bash', 'terminal', 'shell', 'Shell']);

type ZcodeShellToolCall = { command: string } | { malformed: true };

function isStrictMode(): boolean {
  return process.env.PIOPANET_STRICT === '1';
}

/**
 * Default subprocess eval — spawns `bin/pi-opa-net.js eval "<cmd>" --json`
 * (shared engine CLI) and parses stdout as DecisionOutput. This is the
 * production bridge.
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
export async function handleZcodeToolCall(
  payload: Record<string, unknown>,
  ctx: ZcodeToolCallContext,
): Promise<ZcodeToolCallResult> {
  const shellToolCall = getZcodeShellToolCall(payload);
  if (!shellToolCall) return undefined;

  if ('malformed' in shellToolCall) {
    return blockZcodeToolCall(REASON_MALFORMED_SHELL_INPUT);
  }

  const { command } = shellToolCall;

  // Use injected eval OR default subprocess eval.
  const evalCommand = ctx.opaNetEvalCommand ?? defaultEvalCommand;

  let decision: DecisionOutput;
  try {
    decision = await evalCommand(command, { cwd: ctx.cwd });
  } catch {
    // Fail-open default: do not brick the agent on eval errors.
    if (isStrictMode()) {
      return blockZcodeToolCall(REASON_OPA_NET_FAILED_CLOSED);
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
      const auditSink = ctx.auditSink ?? createFilesystemAuditSink(ctx.cwd);
      await writeAuditEntry({
        sessionId,
        decision,
        auditSink,
      });
    }
    return blockZcodeToolCall(formatBlockMessage(decision));
  }

  // prompt_user (reserved v2) — treat as allow for now.
  return undefined;
}

function getZcodeShellToolCall(payload: Record<string, unknown>): ZcodeShellToolCall | undefined {
  const event = payload as ZcodePreToolUsePayload;
  const toolName = event.toolName ?? event.tool_name;
  if (typeof toolName !== 'string') return undefined;

  if (!ZCODE_SHELL_TOOL_NAMES.has(toolName)) return undefined;

  const toolInput = event.toolInput ?? event.tool_input;
  if (!toolInput || typeof toolInput !== 'object') return { malformed: true };

  const command = toolInput.command;
  if (typeof command !== 'string') return { malformed: true };

  return { command };
}

function formatBlockMessage(decision: DecisionOutput): string {
  const reasons = decision.reasons.map((r) => `${r.rule_id}: ${r.message}`).join('; ');
  const header = decision.summary || 'BLOCKED by OPA-Net';
  return `${header}\nReason: ${reasons}\nRule family: ${decision.reasons[0]?.family ?? 'unknown'}`;
}

function blockZcodeToolCall(reason: string): ZcodeToolCallResult {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}
