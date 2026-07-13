import { describe, expect, it } from 'bun:test';
import { configFromEnv, parseProtectedBranches } from '../../../src/config/Config.ts';

/**
 * RED tests for the protected-branches config (conditional-branch-gate D4).
 *
 * Deviation note: the task asked to extend tests/unit/config/Config.test.ts.
 * However Bun throws a hard SyntaxError when a named export (`parseProtectedBranches`)
 * is imported from a module that does not yet export it, which would crash the
 * WHOLE Config.test.ts file and break the 7 pre-existing passing config tests —
 * violating the "existing 106 tests still pass" requirement. Putting the new
 * tests in a dedicated file isolates the RED failure to these new tests only.
 * The GREEN phase just needs to add `parseProtectedBranches` (+ config wiring)
 * to src/config/Config.ts; no test edits required.
 */

describe('parseProtectedBranches', () => {
  it('defaults to the 5-branch set when undefined', () => {
    expect(parseProtectedBranches(undefined)).toEqual(['main', 'staging', 'dev', 'test', 'master']);
  });

  it('empty string → [] (disables the rule)', () => {
    expect(parseProtectedBranches('')).toEqual([]);
  });

  it('comma-separated list → array', () => {
    expect(parseProtectedBranches('trunk,develop')).toEqual(['trunk', 'develop']);
  });

  it('trims whitespace around each entry', () => {
    expect(parseProtectedBranches(' main , staging ')).toEqual(['main', 'staging']);
  });

  it('drops empty tokens between commas', () => {
    expect(parseProtectedBranches('main,,staging,')).toEqual(['main', 'staging']);
  });
});

describe('configFromEnv — protectedBranches', () => {
  it('reads PIOPANET_PROTECTED_BRANCHES and populates EngineConfig.protectedBranches', () => {
    const old = process.env.PIOPANET_PROTECTED_BRANCHES;
    process.env.PIOPANET_PROTECTED_BRANCHES = 'trunk,develop';
    try {
      const c = configFromEnv('/p.rego');
      expect(c.protectedBranches).toEqual(['trunk', 'develop']);
    } finally {
      // Restore prior state exactly; `if (old)` would treat '' as absent and
      // leak an altered env value into later tests.
      if (old !== undefined) process.env.PIOPANET_PROTECTED_BRANCHES = old;
      else delete process.env.PIOPANET_PROTECTED_BRANCHES;
    }
  });

  it('uses the 5-branch default when PIOPANET_PROTECTED_BRANCHES is unset', () => {
    const old = process.env.PIOPANET_PROTECTED_BRANCHES;
    delete process.env.PIOPANET_PROTECTED_BRANCHES;
    try {
      const c = configFromEnv('/p.rego');
      expect(c.protectedBranches).toEqual(['main', 'staging', 'dev', 'test', 'master']);
    } finally {
      if (old !== undefined) process.env.PIOPANET_PROTECTED_BRANCHES = old;
      else delete process.env.PIOPANET_PROTECTED_BRANCHES;
    }
  });

  it('PIOPANET_PROTECTED_BRANCHES="" → [] (disables)', () => {
    const old = process.env.PIOPANET_PROTECTED_BRANCHES;
    process.env.PIOPANET_PROTECTED_BRANCHES = '';
    try {
      const c = configFromEnv('/p.rego');
      expect(c.protectedBranches).toEqual([]);
    } finally {
      if (old !== undefined) process.env.PIOPANET_PROTECTED_BRANCHES = old;
      else delete process.env.PIOPANET_PROTECTED_BRANCHES;
    }
  });
});
