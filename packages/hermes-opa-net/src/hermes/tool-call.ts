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

type HermesApi = {
  register_hook: (
    hook: 'pre_tool_call',
    handler: (kwargs: Record<string, unknown>) => Promise<HermesToolCallResult>,
  ) => void;
};

export type EvalOpts = { cwd?: string; env?: NodeJS.ProcessEnv };

export type HermesToolCallContext = {
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

/**
 * Hermes-canonical block directive. Hermes plugins.py @2101-2175 expects
 * `{action: 'block', message: string}` to veto a tool call.
 */
export type HermesToolCallResult = { action: 'block'; message: string } | undefined;

type HermesToolCallEvent = {
  tool_name?: string;
  tool_call_id?: string;
  args?: Record<string, unknown>;
};

type HermesShellToolAdapter = {
  commandField: string;
  cwdField?: string;
};

/**
 * Hermes shell tool adapters. Hermes uses 'terminal' as the canonical shell
 * tool name, but also accepts 'bash' for backward compat. The command lives
 * in args.command, cwd in args.cwd (or args.working_directory for Grok compat).
 */
const HERMES_SHELL_TOOL_ADAPTERS: Partial<Record<string, HermesShellToolAdapter>> = {
  terminal: { commandField: 'command', cwdField: 'cwd' },
  bash: { commandField: 'command', cwdField: 'cwd' },
  shell: { commandField: 'command', cwdField: 'working_directory' },
};

type HermesShellToolCall = { command: string; cwd: string } | { malformed: true };

/**
 * Register the pre_tool_call hook on a Hermes plugin ctx.
 *
 * Hermes's dispatcher invokes the callback with a SINGLE kwargs object
 * ({tool_name, args, tool_call_id, session_id, ...}) — NOT (event, ctx).
 * This wrapper bridges that to handleHermesToolCall(event, ctx) by building
 * the context from process state (cwd, HERMES_SESSION_FILE env).
 */
export function registerPreToolCallHook(api: HermesApi): void {
  const wrapped = (kwargs: Record<string, unknown>): Promise<HermesToolCallResult> => {
    const ctx: HermesToolCallContext = {
      cwd: process.cwd(),
      sessionManager: {
        getSessionFile: () => process.env.HERMES_SESSION_FILE,
      },
    };
    return handleHermesToolCall(kwargs, ctx);
  };
  api.register_hook('pre_tool_call', wrapped);
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
export async function handleHermesToolCall(
  event: Record<string, unknown>,
  ctx: HermesToolCallContext,
): Promise<HermesToolCallResult> {
  const shellToolCall = getHermesShellToolCall(event, ctx);
  if (!shellToolCall) return undefined;

  if ('malformed' in shellToolCall) {
    return blockHermesToolCall(REASON_MALFORMED_SHELL_INPUT);
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
      return blockHermesToolCall(REASON_OPA_NET_FAILED_CLOSED, command);
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
    return blockHermesToolCall(formatBlockMessage(decision), command);
  }

  // prompt_user (reserved v2) — treat as allow for now.
  return undefined;
}

function getHermesShellToolCall(
  event: Record<string, unknown>,
  ctx: HermesToolCallContext,
): HermesShellToolCall | undefined {
  const toolCall = event as HermesToolCallEvent;
  if (typeof toolCall.tool_name !== 'string') return undefined;

  const adapter = HERMES_SHELL_TOOL_ADAPTERS[toolCall.tool_name];
  if (!adapter) return undefined;
  if (!toolCall.args || typeof toolCall.args !== 'object') return { malformed: true };

  const command = toolCall.args[adapter.commandField];
  if (typeof command !== 'string') return { malformed: true };

  const cwdInput = adapter.cwdField ? toolCall.args[adapter.cwdField] : undefined;
  const cwd = typeof cwdInput === 'string' ? resolve(ctx.cwd, cwdInput) : ctx.cwd;
  return { command, cwd };
}

function formatBlockMessage(decision: DecisionOutput): string {
  const reasons = decision.reasons.map((r) => `${r.rule_id}: ${r.message}`).join('; ');
  const header = decision.summary || 'BLOCKED by OPA-Net';
  return `${header}\nReason: ${reasons}\nRule family: ${decision.reasons[0]?.family ?? 'unknown'}`;
}

function blockHermesToolCall(message: string, _command?: string): HermesToolCallResult {
  return { action: 'block', message };
}
