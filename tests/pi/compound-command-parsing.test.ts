import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DecisionOutput } from '../../src/output/DecisionBuilder';
import { CommandParserCoordinator } from '../../src/parser/CommandParser';
import { handlePiToolCall } from '../../src/pi/tool-call';

const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/1.18.2/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);

async function runEval(command: string): Promise<{ exitCode: number; json: any }> {
  const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');
  return new Promise((accept, reject) => {
    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const json = stdout.trim() ? JSON.parse(stdout) : {};
        accept({ exitCode: code ?? 0, json });
      } catch {
        reject(new Error(`non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`));
      }
    });
  });
}

describe.if(OPA_AVAILABLE)('compound command parsing (env prefix via semicolon)', () => {
  it('blocks "export FOO=bar; git stash pop" (currently ALLOWED — BUG)', async () => {
    const { exitCode, json } = await runEval('export FOO=bar; git stash pop');
    expect(json.decision).toBe('deny');
    expect(exitCode).toBe(2);
  });

  it('parser extracts "export" for compound command (CLI handles splitting)', () => {
    const parser = new CommandParserCoordinator();
    const parsed = parser.parse('export FOO=bar; git stash pop');
    // Parser sees the full string and extracts the first program.
    // CLI-layer fix splits on ';' and evaluates each segment separately.
    expect(parsed.program).toBe('export');
  });

  it('blocks "export FOO=bar; git reset --hard" (currently ALLOWED — BUG)', async () => {
    const { json } = await runEval('export FOO=bar; git reset --hard');
    expect(json.decision).toBe('deny');
  });

  it('blocks full pi-bash-guard preamble + git stash pop', async () => {
    const preamble =
      'export GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true EDITOR=true VISUAL=true PAGER=cat DEBIAN_FRONTEND=noninteractive NPM_CONFIG_YES=true CI=1 NODE_NO_READLINE=1 GIT_ASKPASS=true SSH_ASKPASS=/bin/false';
    const { json } = await runEval(`${preamble}; git stash pop`);
    expect(json.decision).toBe('deny');
  });

  it('allows "export FOO=bar; git status" (safe command after prefix)', async () => {
    const { json } = await runEval('export FOO=bar; git status');
    expect(json.decision).toBe('allow');
  });

  it('allows "export FOO=bar; ls -la" (safe non-git command)', async () => {
    const { json } = await runEval('export FOO=bar; ls -la');
    expect(json.decision).toBe('allow');
  });
});

describe('compound command handler passes raw string to CLI', () => {
  it('handlePiToolCall passes compound string to evalCommand (CLI handles splitting)', async () => {
    const captured: string[] = [];

    const decision: DecisionOutput = {
      schema_version: '1.0',
      decision: 'deny',
      action: 'block',
      source: 'opa',
      reasons: [
        {
          rule_id: 'block-git-stash-mutations',
          message: 'Do not mutate stashes in shared work',
          family: 'git',
          severity: 'block',
        },
      ],
      input: {
        raw: 'git stash pop',
        program: 'git',
        subcommand: 'stash',
        args: ['pop'],
        parse_confidence: 'full',
      },
      summary: 'BLOCKED: git stash pop (rule: block-git-stash-mutations)',
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

    const result = await handlePiToolCall(
      {
        type: 'tool_call',
        toolCallId: 'pi-tool-call',
        toolName: 'bash',
        input: { command: 'export FOO=bar; git stash pop' },
      },
      {
        cwd: process.cwd(),
        sessionManager: { getSessionFile: () => undefined },
        opaNetEvalCommand: async (command) => {
          captured.push(command);
          return decision;
        },
      },
    );

    expect(result).toBeDefined();
    expect(result?.block).toBe(true);
    expect(captured).toEqual(['export FOO=bar; git stash pop']);
  });
});
