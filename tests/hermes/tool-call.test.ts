/**
 * RED PHASE — hermes extension adapter (hermes-opa-net plugin layer).
 *
 * Hermes hook interface (authoritative, discovered in installed agent source):
 *   - Hermes is a Python CLI coding agent (NousResearch/hermes-agent, v0.16.0),
 *     installed editable at ~/.hermes/hermes-agent/.
 *   - Plugins register a `pre_tool_call` lifecycle hook via
 *     `ctx.register_hook("pre_tool_call", callback)` — an event-handler pattern.
 *     Source: hermes_cli/plugins.py (register_hook / invoke_hook @1892) and
 *     agent/shell_hooks.py (wire protocol @74-100).
 *   - The Python callback is invoked with kwargs: tool_name, args, session_id,
 *     task_id, tool_call_id, turn_id, api_request_id, middleware_trace.
 *     Real example: plugins/observability/langfuse/__init__.py @1042
 *       on_pre_tool_call(*, tool_name="", args=None, task_id="", session_id="",
 *                         tool_call_id="", turn_id="", api_request_id="", **_)
 *   - Block directive contract (plugins.py _get_pre_tool_call_directive_details
 *     @2101-2175): a callback returns
 *       {"action": "block", "message": "<reason>"}
 *     to veto the tool call. First valid block wins; a block REQUIRES a
 *     non-empty message (it becomes the tool result the model sees). The
 *     Claude-Code shape {"decision":"block","reason":...} is ALSO accepted
 *     (shell_hooks.py @79F translates it). Returning None/undefined = no-op.
 *   - Hook callback exceptions are logged + skipped (plugins.py invoke_hook
 *     try/except) → fail-open at the hook dispatcher layer. This adapter
 *     mirrors pi-opa-net: its OWN fail-mode is governed by PIOPANET_STRICT.
 *   - Hermes shell tool name is "terminal"; the command lives in args.command
 *     (tools/terminal_tool.py @3089/@3130: command=args.get("command")).
 *
 * This adapter mirrors src/pi/tool-call.ts (handlePiToolCall) but:
 *   - event fields use Hermes names: { tool_name, args: { command, cwd? } }
 *   - the block return shape is Hermes-canonical { action:'block', message }
 *     (NOT pi's { block:true, reason }).
 *
 * These tests fail until src/hermes/tool-call.ts exists. They never spawn a
 * real subprocess — `opaNetEvalCommand` is injected per-case.
 */
import { describe, expect, it } from 'bun:test';
import { handleHermesToolCall } from '../../src/hermes/tool-call';
import type { DecisionOutput } from '../../src/output/DecisionBuilder';

type HermesCtx = Parameters<typeof handleHermesToolCall>[1];

function hermesContext(cwd: string, overrides: Partial<HermesCtx> = {}): HermesCtx {
  return {
    cwd,
    sessionManager: { getSessionFile: () => undefined },
    ...overrides,
  };
}

/** Hermes-canonical shell tool event (tool name "terminal", command in args.command). */
function terminalToolCall(command: string) {
  return {
    tool_name: 'terminal',
    tool_call_id: 'hermes-tool-call',
    args: { command },
  };
}

/** bash parity: Hermes internal call-sites also reference "bash" as a shell tool name. */
function bashToolCall(command: string) {
  return {
    tool_name: 'bash',
    tool_call_id: 'hermes-tool-call',
    args: { command },
  };
}

/** Build a deny decision from opa-net engine. */
function denyDecision(
  ruleId: string,
  family: string,
  command: string,
  overrides: Partial<DecisionOutput> = {},
): DecisionOutput {
  return {
    schema_version: '1.0',
    decision: 'deny',
    action: 'block',
    source: 'opa',
    reasons: [
      {
        rule_id: ruleId,
        message: `${ruleId} fired`,
        family,
        severity: 'block',
      },
    ],
    input: {
      raw: command,
      program: command.split(' ')[0] ?? '',
      subcommand: command.split(' ')[1] ?? '',
      args: command.split(' ').slice(2),
      parse_confidence: 'full',
    },
    summary: `BLOCKED: ${command} (rule: ${ruleId})`,
    suggestions: [],
    metadata: {
      engine: 'opa',
      opa_version: '1.18.2',
      rulebook_digest: 'deadbeefdead',
      policy_path: 'policy/safety.rego',
      hostname: 'test',
      session_id: 'sess-test',
    },
    evaluated_at: '2026-07-21T14:00:00.000Z',
    decision_id: '11111111-2222-3333-4444-555555555555',
    duration_ms: 5,
    ...overrides,
  };
}

/** Build an allow decision. */
function allowDecision(command: string, source: DecisionOutput['source'] = 'opa'): DecisionOutput {
  return {
    schema_version: '1.0',
    decision: 'allow',
    action: 'allow',
    source,
    reasons: [],
    input: {
      raw: command,
      program: command.split(' ')[0] ?? '',
      subcommand: '',
      args: [],
      parse_confidence: 'full',
    },
    summary: '',
    suggestions: [],
    metadata: {
      engine: 'opa',
      opa_version: '1.18.2',
      rulebook_digest: 'deadbeefdead',
      policy_path: 'policy/safety.rego',
      hostname: 'test',
      session_id: 'sess-test',
    },
    evaluated_at: '2026-07-21T14:00:00.000Z',
    decision_id: '00000000-0000-0000-0000-000000000000',
    duration_ms: 3,
  };
}

describe('hermes-opa-net pre_tool_call handler', () => {
  it('allows safe bash commands', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git status'),
    });
    const result = await handleHermesToolCall(terminalToolCall('git status'), ctx);
    expect(result).toBeUndefined();
  });

  it('blocks dangerous bash commands (engine denies) and surfaces rule_id in message', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
    });
    const result = await handleHermesToolCall(terminalToolCall('git stash pop'), ctx);
    expect(result?.action).toBe('block');
    expect(result?.message).toContain('BLOCKED');
    expect(result?.message).toContain('block-git-stash-mutations');
  });

  it('blocks git stash pop (rule family: git)', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
    });
    const result = await handleHermesToolCall(bashToolCall('git stash pop'), ctx);
    expect(result?.action).toBe('block');
    expect(result?.message.toLowerCase()).toContain('git');
    expect(result?.message).toContain('git stash pop');
  });

  it('blocks git commit --no-verify (rule: block-git-commit-no-verify)', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-commit-no-verify', 'git', 'git commit --no-verify -m x'),
    });
    const result = await handleHermesToolCall(terminalToolCall('git commit --no-verify -m x'), ctx);
    expect(result?.action).toBe('block');
    expect(result?.message).toContain('block-git-commit-no-verify');
  });

  it('allows unknown tools (not terminal/bash/shell) without invoking engine', async () => {
    let invoked = false;
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    const result = await handleHermesToolCall(
      { tool_name: 'read_file', tool_call_id: 'hermes-tool-call', args: { command: 'rm -rf .' } },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(invoked).toBe(false);
  });

  it('fails OPEN by default when engine subprocess throws', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        throw new Error('subprocess crashed');
      },
    });
    const result = await handleHermesToolCall(terminalToolCall('git stash pop'), ctx);
    expect(result).toBeUndefined();
  });

  it('fails CLOSED when PIOPANET_STRICT=1 + engine throws', async () => {
    const prev = process.env.PIOPANET_STRICT;
    process.env.PIOPANET_STRICT = '1';
    try {
      const ctx = hermesContext(process.cwd(), {
        opaNetEvalCommand: async () => {
          throw new Error('subprocess crashed');
        },
      });
      const result = await handleHermesToolCall(terminalToolCall('git stash pop'), ctx);
      expect(result?.action).toBe('block');
      expect(result?.message.toLowerCase()).toContain('fail-closed');
    } finally {
      if (prev === undefined) delete process.env.PIOPANET_STRICT;
      else process.env.PIOPANET_STRICT = prev;
    }
  });

  it('unlock-key passthrough: source=opa-unlocked → returns undefined', async () => {
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git stash pop', 'opa-unlocked'),
    });
    const result = await handleHermesToolCall(terminalToolCall('git stash pop'), ctx);
    expect(result).toBeUndefined();
  });

  it('preserves decision_id in audit log when sessionId present', async () => {
    const written: unknown[] = [];
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
      sessionManager: { getSessionFile: () => '/tmp/fake-hermes-session.jsonl' },
      auditSink: {
        write: (entry: unknown) => {
          written.push(entry);
          return Promise.resolve();
        },
      },
    });
    await handleHermesToolCall(terminalToolCall('git stash pop'), ctx);
    expect(written.length).toBe(1);
    const entry = written[0] as { decision_id?: string };
    expect(entry.decision_id).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('blocks malformed terminal tool input (no command string) — fail-closed', async () => {
    let invoked = false;
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    // args present but command missing → malformed.
    const result = await handleHermesToolCall(
      { tool_name: 'terminal', tool_call_id: 'hermes-tool-call', args: {} },
      ctx,
    );
    expect(result?.action).toBe('block');
    expect(result?.message.toLowerCase()).toContain('fail-closed');
    expect(invoked).toBe(false);
  });

  it('resolves cwd from terminal tool args (Hermes working_directory passthrough)', async () => {
    let receivedCwd: string | undefined;
    const ctx = hermesContext(process.cwd(), {
      opaNetEvalCommand: async (cmd, opts) => {
        receivedCwd = opts?.cwd;
        return denyDecision('block-git-reset-hard', 'git', cmd);
      },
    });
    const result = await handleHermesToolCall(
      {
        tool_name: 'terminal',
        tool_call_id: 'hermes-tool-call',
        args: { command: 'git reset --hard', cwd: '/tmp/hermes-sub' },
      },
      ctx,
    );
    expect(result?.action).toBe('block');
    expect(receivedCwd).toContain('hermes-sub');
  });
});
