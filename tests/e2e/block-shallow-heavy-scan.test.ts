/**
 * e2e tests for the shallow heavy scan gate (ban-shallow-heavy-scan / GROUP L).
 *
 * Deny class: heavy recursive scan program (find/du/rg/fd/rgrep always-heavy;
 * grep/egrep -r; ls -R; eza -T without -L) targeting an absolute path at
 * depth <= 2. Depth >= 3 allowed (LD4). eza -T -L N stays allowed (LD2).
 *
 * Rule ID (unlock key, LD-L1 per-rule, no god-key LD-L2):
 *   block-shallow-heavy-scan
 *
 * Fail-open (`default allow := true`) must not be weakened. Deny-class
 * assertions require source !== 'fail-open'.
 */
import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mintUnlockKey } from '../../src/cli/unlock-key.ts';
import { RULES } from '../../src/rules/index.ts';

const OPA_BIN = process.env.OPA_BIN ?? '/home/bhd/.local/share/mise/installs/opa/1.18.2/opa';
const OPA_AVAILABLE = existsSync(OPA_BIN);
const SKIP_REASON = !OPA_AVAILABLE ? 'OPA binary not found' : '';

const SCAN_RULE = 'block-shallow-heavy-scan';

const ROOT = resolve(import.meta.dir, '../../');
const BIN = resolve(ROOT, 'bin/pi-opa-net.js');
const FIXTURE_PATH = resolve(ROOT, 'tests/fixtures/shallow-heavy-scan.json');
const REGO_PATH = resolve(ROOT, 'policy/safety.rego');

setDefaultTimeout(15_000);

interface FixtureCase {
  id: string;
  command: string;
  expect: 'deny' | 'allow';
  rule_id: string | null;
  notes: string;
}

interface FixtureTable {
  source: string;
  rule_ids: { scan: string };
  cases: FixtureCase[];
}

const FIXTURE: FixtureTable = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

function expectRuleRegistered(ruleId: string): void {
  const ids = RULES.map((r) => r.ruleId);
  expect(ids, `catalog must register ${ruleId}`).toContain(ruleId);
}

interface EvalResult {
  exitCode: number;
  json: {
    decision?: string;
    action?: string;
    source?: string;
    reasons?: Array<{ rule_id?: string; family?: string }>;
    [k: string]: unknown;
  };
}

function runEval(
  command: string,
  extraEnv: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<EvalResult> {
  return new Promise((accept, reject) => {
    const child = spawn('bun', [BIN, 'eval', command, '--json'], {
      env: { ...process.env, OPA_BIN, ...extraEnv },
      cwd: ROOT,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const json = stdout.trim() ? JSON.parse(stdout.trim()) : {};
        accept({ exitCode: code ?? 0, json });
      } catch {
        reject(new Error(`non-JSON stdout: ${stdout.slice(0, 200)}\nstderr: ${stderr}`));
      }
    });
  });
}

function reasonIds(json: EvalResult['json']): string[] {
  return (json.reasons ?? []).map((r) => r.rule_id ?? '');
}

function expectOpaDeny(result: EvalResult, ruleId: string): void {
  const { json, exitCode } = result;
  expect(json.source, 'deny must come from OPA, not the timeout fail-open path').not.toBe(
    'fail-open',
  );
  expect(json.decision).toBe('deny');
  expect(json.action).toBe('block');
  expect(exitCode).toBe(2);
  expect(reasonIds(json)).toContain(ruleId);
}

function expectOpaUnlocked(result: EvalResult): void {
  const { json, exitCode } = result;
  expect(json.source).not.toBe('fail-open');
  expect(json.source).toBe('opa-unlocked');
  expect(json.decision).toBe('allow');
  expect(exitCode).toBe(0);
}

describe('shallow heavy scan gate — catalog (RED until GREEN)', () => {
  it(`registers ${SCAN_RULE}`, () => {
    expectRuleRegistered(SCAN_RULE);
  });

  it('fixture table names the same rule_id the tests assert', () => {
    expect(FIXTURE.rule_ids.scan).toBe(SCAN_RULE);
    expect(FIXTURE.cases.length).toBeGreaterThan(0);
  });
});

describe('shallow heavy scan gate — fail-open must not be weakened', () => {
  it('policy/safety.rego keeps default allow := true', () => {
    const rego = readFileSync(REGO_PATH, 'utf8');
    expect(rego).toMatch(/default allow := true/);
  });
});

describe.if(!SKIP_REASON)('shallow heavy scan gate — DENY without unlock', () => {
  it('du -sh / → DENY (root)', async () => {
    expectOpaDeny(await runEval('du -sh /'), SCAN_RULE);
  });

  it('du -sh /var → DENY (depth 1)', async () => {
    expectOpaDeny(await runEval('du -sh /var'), SCAN_RULE);
  });

  it('du -sh /home → DENY (depth 1)', async () => {
    expectOpaDeny(await runEval('du -sh /home'), SCAN_RULE);
  });

  it('du -sh /home/bhd → DENY (depth 2)', async () => {
    expectOpaDeny(await runEval('du -sh /home/bhd'), SCAN_RULE);
  });

  it('find /usr → DENY (depth 1, non-home)', async () => {
    expectOpaDeny(await runEval('find /usr'), SCAN_RULE);
  });

  it('rg foo /var → DENY (recursive by default)', async () => {
    expectOpaDeny(await runEval('rg foo /var'), SCAN_RULE);
  });

  it('grep -r foo / → DENY (flag-gated)', async () => {
    expectOpaDeny(await runEval('grep -r foo /'), SCAN_RULE);
  });

  it('ls -R / → DENY', async () => {
    expectOpaDeny(await runEval('ls -R /'), SCAN_RULE);
  });

  it('du -sh $HOME → DENY (raw token)', async () => {
    expectOpaDeny(await runEval('du -sh $HOME'), SCAN_RULE);
  });

  it('du -sh ~ → DENY (raw token)', async () => {
    expectOpaDeny(await runEval('du -sh ~'), SCAN_RULE);
  });

  it('du -sh /var/lib/.. → DENY (.. normalization)', async () => {
    expectOpaDeny(await runEval('du -sh /var/lib/..'), SCAN_RULE);
  });

  it('eza -T / → DENY (unbounded tree)', async () => {
    expectOpaDeny(await runEval('eza -T /'), SCAN_RULE);
  });

  it('PIOPANET_UNLOCK_ALL is not a god-key (LD-L2)', async () => {
    expectOpaDeny(await runEval('du -sh /', { PIOPANET_UNLOCK_ALL: '1' }), SCAN_RULE);
  });
});

describe.if(!SKIP_REASON)('shallow heavy scan gate — ALLOW', () => {
  it('du -sh /var/lib/docker → ALLOW (LD4 depth 3)', async () => {
    const { json, exitCode } = await runEval('du -sh /var/lib/docker');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
    expect(reasonIds(json)).not.toContain(SCAN_RULE);
  });

  it('du -sh /home/bhd/.local → ALLOW (depth 3)', async () => {
    const { json, exitCode } = await runEval('du -sh /home/bhd/.local');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('eza -T -L 2 / → ALLOW (bounded discovery)', async () => {
    const { json, exitCode } = await runEval('eza -T -L 2 /');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('du -sh . → ALLOW (cwd-relative)', async () => {
    const { json, exitCode } = await runEval('du -sh .');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('find . → ALLOW (cwd-relative)', async () => {
    const { json, exitCode } = await runEval('find .');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('fd /var → ALLOW (/var is the pattern)', async () => {
    const { json, exitCode } = await runEval('fd /var');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('ls /etc → ALLOW (non-recursive)', async () => {
    const { json, exitCode } = await runEval('ls /etc');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });

  it('du -sh ~/.pi/goals → ALLOW (known goal dir)', async () => {
    const { json, exitCode } = await runEval('du -sh ~/.pi/goals');
    expect(json.decision).toBe('allow');
    expect(exitCode).toBe(0);
  });
});

describe.if(!SKIP_REASON)('shallow heavy scan gate — unlock contract', () => {
  let tempDir: string;
  let saltPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'piopanet-shallow-'));
    saltPath = join(tempDir, 'salt');
    writeFileSync(saltPath, Buffer.from('e2e-test-salt-32-bytes-exactly!!!'), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it(`mintUnlockKey(${SCAN_RULE}) is catalog-known`, () => {
    expect(() => mintUnlockKey({ ruleId: SCAN_RULE, saltPath })).not.toThrow();
  });

  it('du -sh / with per-rule key → ALLOW + source opa-unlocked', async () => {
    expectRuleRegistered(SCAN_RULE);
    const key = mintUnlockKey({ ruleId: SCAN_RULE, saltPath });
    const result = await runEval('du -sh /', {
      PIOPANET_UNLOCK_KEYS: key,
      PIOPANET_UNLOCK_SALT: saltPath,
    });
    expectOpaUnlocked(result);
  });

  it('stash unlock key does not bypass shallow scan (LD-L1)', async () => {
    expectRuleRegistered(SCAN_RULE);
    const stashKey = mintUnlockKey({ ruleId: 'block-git-stash-mutations', saltPath });
    const result = await runEval('du -sh /', {
      PIOPANET_UNLOCK_KEYS: stashKey,
      PIOPANET_UNLOCK_SALT: saltPath,
    });
    expectOpaDeny(result, SCAN_RULE);
    expect(result.json.source).not.toBe('opa-unlocked');
  });
});

describe.if(!SKIP_REASON)('shallow heavy scan gate — fixture table', () => {
  for (const c of FIXTURE.cases) {
    const label = c.id;
    it(`${label}: ${c.command} → ${c.expect.toUpperCase()}`, async () => {
      if (c.expect === 'deny') {
        expect(c.rule_id, `fixture ${c.id} deny case needs rule_id`).toBeTruthy();
        expectRuleRegistered(c.rule_id as string);
      } else {
        expectRuleRegistered(SCAN_RULE);
      }
      const result = await runEval(c.command);
      if (c.expect === 'deny') {
        expectOpaDeny(result, c.rule_id as string);
      } else {
        expect(result.json.decision).toBe('allow');
        expect(result.exitCode).toBe(0);
      }
    });
  }
});

if (SKIP_REASON) {
  describe.skip(`shallow heavy scan gate e2e: ${SKIP_REASON}`, () => {});
}
