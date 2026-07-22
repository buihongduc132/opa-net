/**
 * E2E — hermes extension adapter against real opa-net engine (subprocess).
 *
 * End-to-end: exercises the full pipeline:
 *   Hermes pre_tool_call hook → subprocess `bin/pi-opa-net.js eval --json`
 *   → live OPA + real policy → decision-output.v1 → translate → block message.
 *
 * The hook contract (hermes_cli/plugins.py @2101-2175) returns
 *   {"action":"block","message":...} to veto, None to allow. The handler
 *   under test is handleHermesToolCall (src/hermes/tool-call.ts).
 *
 * Gated on OPA availability (same convention as tests/e2e/pi-extension-e2e.test.ts).
 * Uses `git stash pop` for the deny case (engine actually denies it) and
 * `git status` for the allow case — NOT rm -rf (which the engine allows).
 */
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Gate on OPA availability (same convention as tests/e2e/e2e.test.ts).
const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/1.18.2/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);

/** Spawn bin/pi-opa-net.js for a command, capture JSON stdout + exit code. */
async function runEval(command: string): Promise<{
  stdout: string;
  exitCode: number;
  json: unknown;
}> {
  const binPath = resolve(import.meta.dir, '../../bin/pi-opa-net.js');
  return new Promise((accept, reject) => {
    const child = spawn('bun', [binPath, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const json = stdout.trim() ? JSON.parse(stdout) : null;
        accept({ stdout, exitCode: code ?? 0, json });
      } catch {
        reject(new Error(`non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`));
      }
    });
  });
}

describe.if(OPA_AVAILABLE)('hermes-opa-net extension e2e (real subprocess + OPA)', () => {
  it('subprocess contract: git stash pop → deny (exit 2) with block-git-stash rule', async () => {
    const { exitCode, json } = await runEval('git stash pop');
    const decision = json as { decision: string; reasons?: Array<{ rule_id: string }> };

    // Engine MUST have denied.
    expect(exitCode).toBe(2);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons?.length ?? 0).toBeGreaterThan(0);

    const ruleId = decision.reasons?.[0]?.rule_id ?? '';
    expect(ruleId.length).toBeGreaterThan(0);
    expect(ruleId).toContain('block-git-stash');
  });

  it('subprocess contract: git status → allow (exit 0)', async () => {
    const { exitCode, json } = await runEval('git status');
    const decision = json as { decision: string };

    expect(exitCode).toBe(0);
    expect(decision.decision).toBe('allow');
  });

  it('translates a deny decision into {action:"block",message} via real pipeline', async () => {
    // Invoke the adapter with the SAME real subprocess (no injection). This
    // exercises the default eval bridge end-to-end: real OPA + real policy
    // → decision-output.v1 → Hermes-canonical block directive.
    const { handleHermesToolCall } = await import('../../src/hermes/tool-call');
    const terminalEvent = {
      tool_name: 'terminal',
      tool_call_id: 'hermes-e2e-1',
      args: { command: 'git stash pop' },
    };
    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionFile: () => undefined },
    };
    const result = await handleHermesToolCall(terminalEvent, ctx);
    expect(result).toBeDefined();
    expect((result as { action?: string }).action).toBe('block');
    expect((result as { message?: string }).message).toContain('BLOCKED');
    expect((result as { message?: string }).message).toContain('git stash pop');
  });

  it('translates an allow decision into undefined via real pipeline', async () => {
    const { handleHermesToolCall } = await import('../../src/hermes/tool-call');
    const terminalEvent = {
      tool_name: 'terminal',
      tool_call_id: 'hermes-e2e-2',
      args: { command: 'git status' },
    };
    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionFile: () => undefined },
    };
    const result = await handleHermesToolCall(terminalEvent, ctx);
    expect(result).toBeUndefined();
  });

  it('Hermes hook dispatcher contract: registered callback fires on pre_tool_call', async () => {
    // Simulate Hermes's plugin registration + hook dispatch: register the
    // default-export, then invoke the captured callback with a terminal event
    // and assert the Hermes-canonical block shape.
    const extension = (await import('../../src/hermes/index')).default;
    let capturedCb: ((kwargs: Record<string, unknown>) => unknown) | null = null;
    const fakeCtx = {
      register_hook: (hook: string, cb: (kwargs: Record<string, unknown>) => unknown) => {
        if (hook === 'pre_tool_call') capturedCb = cb;
      },
    };
    (extension as (ctx: unknown) => void)(fakeCtx);
    expect(capturedCb).not.toBeNull();

    const directive = await capturedCb!({
      tool_name: 'terminal',
      tool_call_id: 'hermes-e2e-3',
      args: { command: 'git stash pop' },
      session_id: '',
    });
    expect(directive).toBeDefined();
    expect((directive as { action?: string }).action).toBe('block');
    expect((directive as { message?: string }).message).toContain('BLOCKED');
  });
});
