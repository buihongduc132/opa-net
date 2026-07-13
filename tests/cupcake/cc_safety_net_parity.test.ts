import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../');
const FIXTURE = resolve(ROOT, 'tests/fixtures/user-rules.rulebook.json');
const FIXTURE_TMP = mkdtempSync(join(tmpdir(), 'cupcake-input-'));

// --- shared types ----------------------------------------------------------

interface DenyReason {
  rule_id: string;
  reason: string;
  severity: string;
}

interface EvaluateOutput {
  decision: 'deny' | 'allow' | string;
  /** Raw deny reasons emitted by policies under data.cupcake.policies.*. */
  deny?: DenyReason[];
  /** Alias of deny (same array contents). */
  reasons?: DenyReason[];
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface RulebookTest {
  command: string;
  expect: 'blocked' | 'allowed';
  rule?: string;
}

interface RulebookRule {
  name: string;
  reason: string;
  command?: string;
  subcommand?: string;
  block_args?: string[];
}

interface Rulebook {
  rulebook_version: number;
  name: string;
  version: string;
  rules: RulebookRule[];
  tests: RulebookTest[];
}

const rulebook: Rulebook = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const ruleNames: string[] = rulebook.rules.map((r) => r.name);

// --- opa binary resolution ------------------------------------------------

/**
 * Resolve the opa binary. Task spec: "Make opa binary path resolve via PATH
 * (it is at /home/bhd/.local/share/mise/installs/opa/1.18.2/opa)". We prefer an
 * explicit mise install when present, otherwise defer to PATH lookup ('opa').
 */
function resolveOpa(): string {
  const candidates = [
    process.env.OPA_BIN,
    process.env.HOME && `${process.env.HOME}/.local/share/mise/installs/opa/1.18.2/opa`,
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return 'opa';
}

const OPA = resolveOpa();
const OPA_AVAILABLE = OPA === 'opa' ? true : existsSync(OPA);

// --- harness ---------------------------------------------------------------

/**
 * Build a Cupcake-format PreToolUse Bash input JSON, write it to a temp file,
 * and spawn `opa eval --format=json -d .cupcake -i <input> 'data.cupcake.system.evaluate'`.
 *
 * Contract for the (not-yet-implemented) cupcake policy:
 *   `data.cupcake.system.evaluate` returns:
 *     {
 *       "decision": "deny" | "allow",
 *       "deny":     [ { "rule_id", "reason", "severity" }, ... ],
 *       "reasons":  [ { "rule_id", "reason", "severity" }, ... ]
 *     }
 * `decision` is "deny" iff `count(deny) > 0`, else "allow". `reasons` aliases `deny`.
 */
function buildInput(
  command: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd: '/tmp',
    session_id: 'test',
    ...overrides,
  };
}

function spawnOpa(inputPath: string): SpawnResult {
  // cwd = worktree root so `-d .cupcake` resolves to the (future) policy dir.
  // 15s per-eval timeout per the task spec.
  const proc = Bun.spawnSync({
    cmd: [
      OPA,
      'eval',
      '--format=json',
      '-d',
      '.cupcake',
      '-i',
      inputPath,
      'data.cupcake.system.evaluate',
    ],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
    timeout: 15000,
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function evaluate(input: Record<string, unknown>): EvaluateOutput {
  const path = join(FIXTURE_TMP, `input-${process.hrtime.bigint()}.json`);
  writeFileSync(path, JSON.stringify(input));
  const r = spawnOpa(path);
  if (r.exitCode !== 0) {
    throw new Error(
      `opa eval exited ${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
    );
  }
  return parseOpaEval(r.stdout);
}

/**
 * Parse the OPA `--format=json` envelope into the cupcake system.evaluate value.
 * Envelope shape: `{ result: [ { expressions: [ { value: {...} } ] } ] }`.
 */
function parseOpaEval(stdout: string): EvaluateOutput {
  const env = JSON.parse(stdout) as {
    result?: Array<{ expressions?: Array<{ value?: unknown }> }>;
  };
  const expr = env.result?.[0]?.expressions?.[0];
  if (!expr || typeof expr.value !== 'object' || expr.value === null) {
    throw new Error(`opa returned no object value; stdout: ${stdout.slice(0, 500)}`);
  }
  return expr.value as EvaluateOutput;
}

// --- scenarios -------------------------------------------------------------

interface ExtraScenario {
  command: string;
  expect: 'blocked' | 'allowed';
  rule?: string;
  /** Optional override of the input envelope (for self-filtering scenarios). */
  input?: Record<string, unknown>;
}

const TMUX_SCENARIOS: ExtraScenario[] = [
  { command: 'tmux kill-server', expect: 'blocked', rule: 'block-tmux-kill-server' },
  { command: 'tmux kill-session -t foo', expect: 'blocked', rule: 'block-tmux-kill-session' },
  { command: 'tmux kill-session -a', expect: 'blocked', rule: 'block-tmux-kill-session' },
  { command: 'tmux ls', expect: 'allowed' },
  { command: 'tmux attach -t work', expect: 'allowed' },
  { command: 'pkill tmux', expect: 'blocked', rule: 'block-pkill-tmux-wezterm' },
  { command: 'pkill -9 wezterm', expect: 'blocked', rule: 'block-pkill-tmux-wezterm' },
  { command: 'pkill -f wezterm-mux-server', expect: 'blocked', rule: 'block-pkill-tmux-wezterm' },
  { command: 'pkill firefox', expect: 'allowed' },
  { command: 'killall tmux', expect: 'blocked', rule: 'block-killall-tmux-wezterm' },
  { command: 'killall wezterm', expect: 'blocked', rule: 'block-killall-tmux-wezterm' },
  { command: 'killall vim', expect: 'allowed' },
];

// --- tests -----------------------------------------------------------------

// Skip when opa is unavailable (CI without mise) — but do NOT skip when the
// .cupcake dir is absent: that is exactly the RED condition we want to surface.
describe.skipIf(!OPA_AVAILABLE)('cc-safety-net cupcake parity', () => {
  describe('rulebook tests[] fixtures → data.cupcake.system.evaluate', () => {
    for (const t of rulebook.tests) {
      const label = `${t.expect === 'blocked' ? 'deny' : 'allow'}: ${t.command}`;
      it(label, () => {
        const out = evaluate(buildInput(t.command));
        if (t.expect === 'blocked') {
          expect(t.rule, `fixture must declare rule for "${t.command}"`).toBeDefined();
          expect(out.decision, `decision for "${t.command}"`).toBe('deny');
          const ids = (out.deny ?? []).map((d) => d.rule_id);
          expect(
            ids,
            `expected rule ${t.rule} in deny.rule_ids for "${t.command}"; got ${JSON.stringify(ids)}`,
          ).toContain(t.rule!);
        } else {
          expect(out.decision, `decision for "${t.command}"`).toBe('allow');
          expect((out.deny ?? []).length, `no deny for "${t.command}"`).toBe(0);
        }
      });
    }
  });

  describe('explicit tmux / pkill / killall scenarios', () => {
    for (const s of TMUX_SCENARIOS) {
      const kind = s.expect === 'blocked' ? 'deny' : 'allow';
      it(`${kind}: ${s.command}`, () => {
        const out = evaluate(buildInput(s.command));
        if (s.expect === 'blocked') {
          expect(s.rule, `scenario must declare rule for "${s.command}"`).toBeDefined();
          expect(out.decision).toBe('deny');
          const ids = (out.deny ?? []).map((d) => d.rule_id);
          expect(ids, `expected ${s.rule}; got ${JSON.stringify(ids)}`).toContain(s.rule!);
        } else {
          expect(out.decision).toBe('allow');
          expect((out.deny ?? []).length).toBe(0);
        }
      });
    }
  });

  describe('parity: every rulebook rule name is produced as a rule_id', () => {
    it('union of deny.rule_ids across ALL blocked fixtures covers every rulebook name', () => {
      const produced = new Set<string>();
      const allBlocked: Array<{ command: string; rule?: string }> = [
        ...rulebook.tests.filter((t) => t.expect === 'blocked'),
        ...TMUX_SCENARIOS.filter((s) => s.expect === 'blocked'),
      ];
      for (const c of allBlocked) {
        const out = evaluate(buildInput(c.command));
        for (const d of out.deny ?? []) produced.add(d.rule_id);
      }
      const missing = ruleNames.filter((n) => !produced.has(n));
      expect(
        missing,
        `rule_ids not produced by any blocked fixture: ${missing.join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('cupcake self-filtering (mandatory contract)', () => {
    // A dangerous command must be allowed when the hook is NOT PreToolUse,
    // or when the tool is NOT Bash. This proves the policy carries the
    // mandatory self-filtering guards inside each deny rule body.
    it('non-Bash tool (Write) with a dangerous command → allow', () => {
      const out = evaluate(buildInput('git reset --hard', { tool_name: 'Write' }));
      expect(out.decision).toBe('allow');
      expect((out.deny ?? []).length).toBe(0);
    });

    it('PostToolUse hook with a dangerous command → allow', () => {
      const out = evaluate(buildInput('git reset --hard', { hook_event_name: 'PostToolUse' }));
      expect(out.decision).toBe('allow');
      expect((out.deny ?? []).length).toBe(0);
    });
  });
});
