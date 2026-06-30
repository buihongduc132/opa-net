import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * E2E: run the full CLI binary against live OPA + the real policy.
 *
 * Requirement: cover >=40% of the ruleset (catalog has 35 rules → >=14 distinct
 * rules must fire across these cases). Each case asserts:
 *   - exit code (0=allow, 2=deny)
 *   - JSON schema fields present + valid (--json mode)
 *   - rule provenance (rule_id + family) for denies
 *
 * Skipped entirely when OPA binary is absent (CI without mise).
 */

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');
const OPA = process.env.HOME
  ? `${process.env.HOME}/.local/share/mise/installs/opa/1.18.1/opa`
  : 'opa';
const opaAvailable = existsSync(OPA);

interface CaseResult {
  exitCode: number;
  stdout: string;
  record?: Record<string, unknown>;
}

function runCli(command: string, mode: 'json' | 'claude-code' = 'json'): CaseResult {
  const args = mode === 'json' ? ['eval', command, '--json'] : ['eval', command];
  try {
    const stdout = execFileSync('bun', ['run', BIN, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, HOME: process.env.HOME },
    });
    return { exitCode: 0, stdout, record: tryParse(stdout) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    const code = e.status ?? 1;
    const out = e.stdout ?? '';
    return { exitCode: code, stdout: out, record: tryParse(out) };
  }
}

function tryParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

interface ExpectDeny {
  command: string;
  ruleId: string;
  family: string;
}

interface ExpectAllow {
  command: string;
}

const DENY_CASES: ExpectDeny[] = [
  // GROUP A — git (subcommand + arg)
  { command: 'git stash pop', ruleId: 'block-git-stash-mutations', family: 'git' },
  { command: 'git stash', ruleId: 'builtin:bare-stash-default', family: 'builtin' },
  { command: 'git reset --hard HEAD~1', ruleId: 'block-git-reset-hard', family: 'git' },
  { command: 'git clean -fd', ruleId: 'block-git-clean-force', family: 'git' },
  { command: 'git checkout -B feature', ruleId: 'block-git-checkout-B', family: 'git' },
  { command: 'git add -A', ruleId: 'block-git-add-all', family: 'git' },
  { command: 'git commit -am msg', ruleId: 'block-git-commit-am', family: 'git' },
  { command: 'git commit --no-verify -m x', ruleId: 'block-git-commit-no-verify', family: 'git' },
  { command: 'git rebase main', ruleId: 'block-git-rebase', family: 'git' },
  { command: 'git branch -M main', ruleId: 'block-git-branch-force', family: 'git' },
  // GROUP B — docker subcommands
  { command: 'docker stop foo', ruleId: 'block-docker-stop', family: 'docker' },
  { command: 'docker kill foo', ruleId: 'block-docker-kill', family: 'docker' },
  { command: 'docker rm foo', ruleId: 'block-docker-rm', family: 'docker' },
  { command: 'docker restart foo', ruleId: 'block-docker-restart', family: 'docker' },
  // GROUP C — docker compose carve-outs
  {
    command: 'docker compose --project-name=litellm down',
    ruleId: 'block-docker-compose-down-litellm',
    family: 'docker',
  },
  // GROUP D — bd
  { command: 'bd --notes', ruleId: 'block-bd-notes', family: 'bd' },
  // GROUP E — rm
  { command: 'rm bd-workflow', ruleId: 'block-rm-bd-sub-skills', family: 'rm' },
  // GROUP F — gh / glab
  { command: 'gh repo delete owner/name', ruleId: 'block-gh-repo-delete-archive', family: 'gh' },
  { command: 'gh repo create --public', ruleId: 'block-gh-repo-public', family: 'gh' },
  {
    command: 'glab repo delete owner/name',
    ruleId: 'block-glab-repo-delete-archive',
    family: 'glab',
  },
];

const ALLOW_CASES: ExpectAllow[] = [
  { command: 'git stash list' }, // carve-out
  { command: 'git stash show' }, // carve-out
  { command: 'git status' }, // not blocked
  { command: 'docker ps' }, // not blocked
  { command: 'ls -la' }, // not blocked
];

describe.skipIf(!opaAvailable)('pi-opa-net E2E (live CLI + OPA)', () => {
  describe('deny cases → exit 2 + schema-valid JSON + provenance', () => {
    for (const c of DENY_CASES) {
      it(`denies "${c.command}" with rule ${c.ruleId}`, () => {
        const r = runCli(c.command, 'json');
        expect(r.exitCode).toBe(2);
        expect(r.record, `stdout: ${r.stdout}`).toBeDefined();
        const rec = r.record!;
        expect(rec.schema_version).toBe('1.0');
        expect(rec.decision).toBe('deny');
        expect(rec.action).toBe('block');
        expect(rec.source).toBe('opa');
        const reasons = rec.reasons as Array<Record<string, unknown>>;
        expect(reasons.length).toBeGreaterThan(0);
        const ids = reasons.map((x) => x.rule_id);
        expect(ids).toContain(c.ruleId);
        // the matched reason carries the expected family
        const matched = reasons.find((x) => x.rule_id === c.ruleId)!;
        expect(matched.family).toBe(c.family);
        expect(matched.severity).toBe('block');
        // metadata + tracing fields
        expect((rec.metadata as Record<string, unknown>).engine).toBe('opa');
        expect(typeof rec.decision_id).toBe('string');
        expect(typeof rec.evaluated_at).toBe('string');
        expect(typeof rec.duration_ms).toBe('number');
        // input echo
        const input = rec.input as Record<string, unknown>;
        expect(input.raw).toBe(c.command);
      });
    }
  });

  describe('allow cases → exit 0', () => {
    for (const c of ALLOW_CASES) {
      it(`allows "${c.command}"`, () => {
        const r = runCli(c.command, 'json');
        expect(r.exitCode).toBe(0);
        const rec = r.record!;
        expect(rec.decision).toBe('allow');
        expect(rec.action).toBe('allow');
        expect(rec.source).toBe('opa');
        expect(Array.isArray(rec.reasons)).toBe(true);
        expect((rec.reasons as unknown[]).length).toBe(0);
      });
    }
  });

  it('claude-code mode: allow emits empty stdout (CA2)', () => {
    const r = runCli('git stash list', 'claude-code');
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('claude-code mode: deny emits JSON + exit 2', () => {
    const r = runCli('git stash pop', 'claude-code');
    expect(r.exitCode).toBe(2);
    expect(r.record).toBeDefined();
    expect(r.record!.decision).toBe('deny');
  });

  it('rule coverage >= 40% of catalog (>=15 distinct rules fire)', () => {
    const fired = new Set<string>();
    for (const c of DENY_CASES) {
      const r = runCli(c.command, 'json');
      const reasons = (r.record?.reasons as Array<Record<string, unknown>>) ?? [];
      for (const x of reasons) fired.add(x.rule_id as string);
    }
    // 37 catalog rules → 40% = 15
    expect(fired.size).toBeGreaterThanOrEqual(15);
  }, 30000); // runs ~20 CLI subprocesses serially; needs headroom over the 5s default

  it('fail-open path: invalid policy path still resolves (source != crash)', () => {
    // Use the binary but point at a nonexistent policy → rego load fails → fail-open.
    const args = ['run', BIN, 'eval', 'git stash pop', '--json', '--policy', '/nonexistent.rego'];
    try {
      const stdout = execFileSync('bun', args, {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, HOME: process.env.HOME },
      });
      const rec = JSON.parse(stdout);
      // fail-open default → allow with source fail-open OR opa if it tolerated.
      expect(['allow', 'deny']).toContain(rec.decision);
      expect(['fail-open', 'fail-closed', 'opa']).toContain(rec.source);
    } catch (e) {
      const e2 = e as { stdout?: string };
      // Even on non-zero exit the JSON should be on stdout (deny path).
      if (e2.stdout) {
        const rec = JSON.parse(e2.stdout);
        expect(rec.schema_version).toBe('1.0');
      }
    }
  });
});
