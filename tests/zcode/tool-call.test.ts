/**
 * RED PHASE — zcode extension adapter (zcode-opa-net plugin layer).
 *
 * ZCode (zai) hook interface (authoritative, verified against the installed
 * bundle at /opt/ZCode/resources/glm/zcode.cjs on 2026-07-22):
 *   - ZCode implements Claude-Code-compatible lifecycle hooks. Plugins declare
 *     hooks in <pluginRoot>/hooks/hooks.json as `{type:"command", command:...}`
 *     entries. ZCode spawns the command per event, piping a JSON payload on
 *     stdin and reading JSON on stdout.
 *   - PreToolUse event: the hook receives stdin
 *       {hookEventName:"PreToolUse", cwd, sessionId, toolName, toolInput:{command}}
 *     (both camelCase toolName/toolInput and snake_case tool_name/tool_input are
 *      accepted by the bundle — toolName|tool_input present in the schema).
 *   - Block directive (bundle zcode.cjs):
 *       permissionDecision:C.enum(["allow","ask","deny"]) + permissionDecisionReason
 *     wrapped in hookSpecificOutput:
 *       {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *         "permissionDecision":"deny","permissionDecisionReason":"..."}}
 *     Returning {} (or no permissionDecision) = allow / no-op.
 *   - Shell tool name in ZCode is "Bash" (Claude-Code compat) with the command
 *     in toolInput.command. ZCode also exposes "terminal" as an alias.
 *
 * This adapter mirrors src/hermes/tool-call.ts but:
 *   - payload fields use ZCode names: { toolName, toolInput: { command } }
 *   - the block return shape is ZCode-canonical
 *     { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } }
 *     (NOT hermes's { action: "block", message }).
 *
 * These tests fail until src/zcode/tool-call.ts exists. They never spawn a
 * real subprocess — `opaNetEvalCommand` is injected per-case.
 */
import { describe, expect, it } from 'bun:test';
import type { DecisionOutput } from '../../src/output/DecisionBuilder';
import { handleZcodeToolCall } from '../../src/zcode/tool-call';

type ZcodeCtx = Parameters<typeof handleZcodeToolCall>[1];

function zcodeContext(cwd: string, overrides: Partial<ZcodeCtx> = {}): ZcodeCtx {
  return {
    cwd,
    sessionManager: { getSessionFile: () => undefined },
    ...overrides,
  };
}

/** ZCode-canonical Bash tool event (toolName "Bash", command in toolInput.command). */
function bashToolCall(command: string) {
  return {
    hookEventName: 'PreToolUse',
    cwd: process.cwd(),
    sessionId: 'zcode-session-1',
    toolName: 'Bash',
    toolInput: { command },
  };
}

/** terminal alias: ZCode also accepts "terminal" as a shell tool name. */
function terminalToolCall(command: string) {
  return {
    hookEventName: 'PreToolUse',
    cwd: process.cwd(),
    sessionId: 'zcode-session-1',
    toolName: 'terminal',
    tool_input: { command },
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
    evaluated_at: '2026-07-22T04:00:00.000Z',
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
    evaluated_at: '2026-07-22T04:00:00.000Z',
    decision_id: '00000000-0000-0000-0000-000000000000',
    duration_ms: 3,
  };
}

describe('zcode-opa-net PreToolUse handler', () => {
  it('allows safe bash commands', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git status'),
    });
    const result = await handleZcodeToolCall(bashToolCall('git status'), ctx);
    expect(result).toBeUndefined();
  });

  it('blocks dangerous bash commands (engine denies) with permissionDecision=deny', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
    });
    const result = await handleZcodeToolCall(bashToolCall('git stash pop'), ctx);
    expect(result?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result?.hookSpecificOutput?.permissionDecisionReason).toContain('BLOCKED');
    expect(result?.hookSpecificOutput?.permissionDecisionReason).toContain(
      'block-git-stash-mutations',
    );
    expect(result?.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
  });

  it('blocks git commit --no-verify (rule: block-git-commit-no-verify)', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-commit-no-verify', 'git', 'git commit --no-verify -m x'),
    });
    const result = await handleZcodeToolCall(bashToolCall('git commit --no-verify -m x'), ctx);
    expect(result?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result?.hookSpecificOutput?.permissionDecisionReason).toContain(
      'block-git-commit-no-verify',
    );
  });

  it('handles terminal tool alias + snake_case tool_input', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
    });
    const result = await handleZcodeToolCall(terminalToolCall('git stash pop'), ctx);
    expect(result?.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows unknown tools (not Bash/terminal/shell) without invoking engine', async () => {
    let invoked = false;
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    const result = await handleZcodeToolCall(
      { hookEventName: 'PreToolUse', toolName: 'Read', toolInput: { command: 'rm -rf .' } },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(invoked).toBe(false);
  });

  it('fails OPEN by default when engine subprocess throws', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        throw new Error('subprocess crashed');
      },
    });
    const result = await handleZcodeToolCall(bashToolCall('git stash pop'), ctx);
    expect(result).toBeUndefined();
  });

  it('fails CLOSED when PIOPANET_STRICT=1 + engine throws', async () => {
    const prev = process.env.PIOPANET_STRICT;
    process.env.PIOPANET_STRICT = '1';
    try {
      const ctx = zcodeContext(process.cwd(), {
        opaNetEvalCommand: async () => {
          throw new Error('subprocess crashed');
        },
      });
      const result = await handleZcodeToolCall(bashToolCall('git stash pop'), ctx);
      expect(result?.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result?.hookSpecificOutput?.permissionDecisionReason?.toLowerCase()).toContain(
        'fail-closed',
      );
    } finally {
      if (prev === undefined) delete process.env.PIOPANET_STRICT;
      else process.env.PIOPANET_STRICT = prev;
    }
  });

  it('unlock-key passthrough: source=opa-unlocked → returns undefined', async () => {
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git stash pop', 'opa-unlocked'),
    });
    const result = await handleZcodeToolCall(bashToolCall('git stash pop'), ctx);
    expect(result).toBeUndefined();
  });

  it('preserves decision_id in audit log when sessionId present', async () => {
    const written: unknown[] = [];
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
      sessionManager: { getSessionFile: () => '/tmp/fake-zcode-session.jsonl' },
      auditSink: {
        write: (entry: unknown) => {
          written.push(entry);
          return Promise.resolve();
        },
      },
    });
    await handleZcodeToolCall(bashToolCall('git stash pop'), ctx);
    expect(written.length).toBe(1);
    const entry = written[0] as { decision_id?: string };
    expect(entry.decision_id).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('blocks malformed Bash tool input (no command string) — fail-closed', async () => {
    let invoked = false;
    const ctx = zcodeContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    const result = await handleZcodeToolCall(
      { hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      ctx,
    );
    expect(result?.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result?.hookSpecificOutput?.permissionDecisionReason?.toLowerCase()).toContain(
      'fail-closed',
    );
    expect(invoked).toBe(false);
  });
});
