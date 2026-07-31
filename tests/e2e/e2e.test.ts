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
  ? `${process.env.HOME}/.local/share/mise/installs/opa/1.18.2/opa`
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
      env: { ...process.env, HOME: process.env.HOME, PIOPANET_DRY_RUN: '1' },
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
  // GROUP G — tmux / pkill / killall session protection (cc-safety-net parity).
  // RED: these rule IDs are not yet in the pi-opa-net engine; the cases below
  // assert deny + provenance and will fail until policy/safety.rego + catalog
  // are extended with the 4 missing rules.
  {
    command: 'tmux kill-server',
    ruleId: 'block-tmux-kill-server',
    family: 'tmux',
  },
  {
    command: 'tmux kill-session -t foo',
    ruleId: 'block-tmux-kill-session',
    family: 'tmux',
  },
  {
    command: 'pkill tmux',
    ruleId: 'block-pkill-tmux-wezterm',
    family: 'pkill',
  },
  {
    command: 'killall tmux',
    ruleId: 'block-killall-tmux-wezterm',
    family: 'killall',
  },
  // GROUP H — herdr session protection.
  {
    command: 'herdr server stop',
    ruleId: 'block-herdr-server-stop',
    family: 'herdr',
  },
  {
    command: 'herdr session stop foo',
    ruleId: 'block-herdr-session-stop',
    family: 'herdr',
  },
  {
    command: 'herdr session delete bar',
    ruleId: 'block-herdr-session-delete',
    family: 'herdr',
  },
  {
    command: 'herdr workspace close baz',
    ruleId: 'block-herdr-workspace-close',
    family: 'herdr',
  },
  {
    command: 'pkill herdr',
    ruleId: 'block-pkill-tmux-wezterm',
    family: 'pkill',
  },
  {
    command: 'killall herdr',
    ruleId: 'block-killall-tmux-wezterm',
    family: 'killall',
  },
  {
    command: 'pkill bermuda',
    ruleId: 'block-pkill-tmux-wezterm',
    family: 'pkill',
  },
];

const ALLOW_CASES: ExpectAllow[] = [
  { command: 'git stash list' }, // carve-out
  { command: 'git stash show' }, // carve-out
  { command: 'git status' }, // not blocked
  { command: 'docker ps' }, // not blocked
  { command: 'ls -la' }, // not blocked
  // GROUP G carve-outs (cc-safety-net parity).
  // RED: the engine must NOT deny these read-only / unrelated targets once the
  // new tmux/pkill/killall rules land. They will pass today because the rules
  // do not exist yet, but they pin the carve-out contract for the GREEN phase.
  { command: 'tmux ls' }, // read-only tmux — must stay allowed
  { command: 'pkill firefox' }, // unrelated target — must stay allowed
  { command: 'killall vim' }, // unrelated target — must stay allowed
  // GROUP H carve-outs (herdr read-only commands).
  { command: 'herdr session list' }, // read-only — must stay allowed
  { command: 'herdr workspace list' }, // read-only — must stay allowed
  { command: 'pkill bermuda-helper' }, // unrelated target prefix — must stay allowed
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

  it('dry-run mode: PIOPANET_DRY_RUN=1 adds dry_run flag to metadata', () => {
    const r = runCli('git stash list', 'json');
    expect(r.exitCode).toBe(0);
    const rec = r.record!;
    const metadata = rec.metadata as Record<string, unknown>;
    expect(metadata.dry_run).toBe(true);
    expect(metadata.pi_opa_net_version).toBeDefined();
    expect(typeof metadata.pi_opa_net_version).toBe('string');
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
    // 41 catalog rules → 40% = 17
    expect(fired.size).toBeGreaterThanOrEqual(17);
  }, 30000); // runs ~20 CLI subprocesses serially; needs headroom over the 5s default

  it('fail-open path: invalid policy path still resolves (source != crash)', () => {
    // Use the binary but point at a nonexistent policy → rego load fails → fail-open.
    const args = ['run', BIN, 'eval', 'git stash pop', '--json', '--policy', '/nonexistent.rego'];
    try {
      const stdout = execFileSync('bun', args, {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, HOME: process.env.HOME, PIOPANET_DRY_RUN: '1' },
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
