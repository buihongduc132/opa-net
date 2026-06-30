import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { defaultPolicyPath, runCli } from '../../../src/cli/run.ts';

const OPA = process.env.HOME
  ? `${process.env.HOME}/.local/share/mise/installs/opa/1.18.1/opa`
  : 'opa';
const opaAvailable = existsSync(OPA);

describe('defaultPolicyPath', () => {
  it('resolves to the bundled safety.rego', () => {
    const p = defaultPolicyPath();
    expect(p.endsWith('policy/safety.rego')).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});

describe('runCli — empty command returns exit 0 + empty stdout', () => {
  it('handles empty string command', async () => {
    const r = await runCli({ command: '', mode: 'json', policyPath: defaultPolicyPath() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe.skipIf(!opaAvailable)('runCli — programmatic API (live OPA)', () => {
  it('deny path returns exit 2 + schema JSON', async () => {
    const r = await runCli({
      command: 'git stash pop',
      mode: 'json',
      policyPath: defaultPolicyPath(),
    });
    expect(r.exitCode).toBe(2);
    const rec = JSON.parse(r.stdout);
    expect(rec.decision).toBe('deny');
    expect(rec.schema_version).toBe('1.0');
  });

  it('claude-code allow path returns exit 0 + empty stdout', async () => {
    const r = await runCli({
      command: 'git stash list',
      mode: 'claude-code',
      policyPath: defaultPolicyPath(),
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});
