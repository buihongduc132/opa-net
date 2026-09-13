/**
 * RED PHASE — pi extension adapter (pi-opa-net plugin layer).
 *
 * These tests fail until src/pi/tool-call.ts exists. They mirror the
 * pi-safety-net/src/pi/tool-call.ts shape: a `handlePiToolCall(event, ctx)`
 * function that returns `{ block: true; reason: string } | undefined`.
 *
 * Difference from pi-safety-net: instead of calling analyzeCommand() inline,
 * the handler invokes the opa-net engine (subprocess `pi-opa-net eval --json`)
 * and translates decision-output.v1 → safety-net block message. Tests inject
 * `opaNetEvalCommand` so unit tests never spawn a real subprocess.
 */
import { describe, expect, it } from 'bun:test';
import type { DecisionOutput } from '../../src/output/DecisionBuilder';
import { handlePiToolCall } from '../../src/pi/tool-call';

type PiCtx = Parameters<typeof handlePiToolCall>[1];

function piContext(cwd: string, overrides: Partial<PiCtx> = {}): PiCtx {
  return {
    cwd,
    sessionManager: { getSessionFile: () => undefined },
    ...overrides,
  };
}

function bashToolCall(command: string) {
  return {
    type: 'tool_call',
    toolCallId: 'pi-tool-call',
    toolName: 'bash',
    input: { command },
  };
}

function shellToolCall(input: Partial<{ command: string; working_directory: string }> = {}) {
  return {
    type: 'tool_call',
    toolCallId: 'pi-tool-call',
    toolName: 'Shell',
    input,
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
      opa_version: '0.68.0',
      rulebook_digest: 'deadbeef',
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
      opa_version: '0.68.0',
      rulebook_digest: 'deadbeef',
      policy_path: 'policy/safety.rego',
      hostname: 'test',
      session_id: 'sess-test',
    },
    evaluated_at: '2026-07-21T14:00:00.000Z',
    decision_id: '00000000-0000-0000-0000-000000000000',
    duration_ms: 3,
  };
}

describe('pi-opa-net tool_call handler', () => {
  it('allows safe bash commands', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git status'),
    });
    const result = await handlePiToolCall(bashToolCall('git status'), ctx);
    expect(result).toBeUndefined();
  });

  it('blocks dangerous bash commands (rm -rf .) and surfaces rule_id', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => denyDecision('block-rm-rf-pwd', 'rm', 'rm -rf .'),
    });
    const result = await handlePiToolCall(bashToolCall('rm -rf .'), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('BLOCKED');
    expect(result?.reason).toContain('rm -rf .');
  });

  it('blocks git stash pop (rule family: git)', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
    });
    const result = await handlePiToolCall(bashToolCall('git stash pop'), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('git');
    expect(result?.reason).toContain('git stash pop');
  });

  it('blocks git stash drop similarly', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash drop'),
    });
    const result = await handlePiToolCall(bashToolCall('git stash drop'), ctx);
    expect(result?.block).toBe(true);
  });

  it('blocks git commit --no-verify (rule: block-git-commit-no-verify)', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-commit-no-verify', 'git', 'git commit --no-verify -m x'),
    });
    const result = await handlePiToolCall(bashToolCall('git commit --no-verify -m x'), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('block-git-commit-no-verify');
  });

  it('blocks git branch -D <name> (rule family: git)', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-branch-force', 'git', 'git branch -D feature-x'),
    });
    const result = await handlePiToolCall(bashToolCall('git branch -D feature-x'), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('block-git-branch-force');
  });

  it('allows unknown tools (not bash/Shell) without invoking engine', async () => {
    let invoked = false;
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    const result = await handlePiToolCall(
      {
        type: 'tool_call',
        toolCallId: 'pi-tool-call',
        toolName: 'Read',
        input: { command: 'rm -rf .' },
      },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(invoked).toBe(false);
  });

  it('handles Grok Shell tool with working_directory (cwd resolution)', async () => {
    let receivedCwd: string | undefined;
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async (cmd, opts) => {
        receivedCwd = opts?.cwd;
        return denyDecision('block-git-reset-hard', 'git', cmd);
      },
    });
    const result = await handlePiToolCall(
      shellToolCall({ command: 'git reset --hard', working_directory: '/tmp/sub' }),
      ctx,
    );
    expect(result?.block).toBe(true);
    expect(receivedCwd).toContain('sub');
  });

  it('fails OPEN by default when engine subprocess throws', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        throw new Error('subprocess crashed');
      },
    });
    const result = await handlePiToolCall(bashToolCall('rm -rf .'), ctx);
    expect(result).toBeUndefined();
  });

  it('fails CLOSED when PIOPANET_STRICT=1 + engine throws', async () => {
    const prev = process.env.PIOPANET_STRICT;
    process.env.PIOPANET_STRICT = '1';
    try {
      const ctx = piContext(process.cwd(), {
        opaNetEvalCommand: async () => {
          throw new Error('subprocess crashed');
        },
      });
      const result = await handlePiToolCall(bashToolCall('rm -rf .'), ctx);
      expect(result?.block).toBe(true);
      expect(result?.reason.toLowerCase()).toContain('fail-closed');
    } finally {
      if (prev === undefined) delete process.env.PIOPANET_STRICT;
      else process.env.PIOPANET_STRICT = prev;
    }
  });

  it('unlock-key passthrough: source=opa-unlocked → returns undefined', async () => {
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => allowDecision('git stash pop', 'opa-unlocked'),
    });
    const result = await handlePiToolCall(bashToolCall('git stash pop'), ctx);
    expect(result).toBeUndefined();
  });

  it('preserves decision_id in audit log when sessionId present', async () => {
    const written: unknown[] = [];
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () =>
        denyDecision('block-git-stash-mutations', 'git', 'git stash pop'),
      sessionManager: { getSessionFile: () => '/tmp/fake-session.jsonl' },
      auditSink: {
        write: (entry: unknown) => {
          written.push(entry);
          return Promise.resolve();
        },
      },
    });
    await handlePiToolCall(bashToolCall('git stash pop'), ctx);
    expect(written.length).toBe(1);
    const entry = written[0] as { decision_id?: string };
    expect(entry.decision_id).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('blocks malformed Shell tool input (no command string) — fail-closed', async () => {
    let invoked = false;
    const ctx = piContext(process.cwd(), {
      opaNetEvalCommand: async () => {
        invoked = true;
        return allowDecision('whatever');
      },
    });
    const result = await handlePiToolCall(shellToolCall({}), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason.toLowerCase()).toContain('fail-closed');
    expect(invoked).toBe(false);
  });
});
