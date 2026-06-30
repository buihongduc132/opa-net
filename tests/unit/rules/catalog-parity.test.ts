import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RULES } from '../../../src/rules/index.ts';

const ROOT = resolve(import.meta.dir, '../../../');
const REGO = readFileSync(resolve(ROOT, 'policy/safety.rego'), 'utf8');

/**
 * Extract every deny message string from safety.rego.
 * Handles two forms:
 *   1. `msg := "..."`  (standard deny rules)
 *   2. string values inside `docker_blocked_subcommands := { "k": "v", ... }`
 * sprintf-produced messages (gcloud/bq) are dynamic and excluded by design.
 */
function extractRegoMessages(rego: string): Set<string> {
  const msgs = new Set<string>();
  // Form 1: msg := "..."
  const re = /msg\s*:=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  m = re.exec(rego);
  while (m !== null) {
    msgs.add(m[1].replace(/\\"/g, '"'));
    m = re.exec(rego);
  }
  // Form 2: values inside docker_blocked_subcommands map.
  const blockMatch = /docker_blocked_subcommands\s*:?=\s*\{([\s\S]*?)\n\}/.exec(rego);
  if (blockMatch) {
    const valRe = /:\s*"((?:[^"\\]|\\.)*)"/.exec;
    // Each line: "key": "value message",
    for (const line of blockMatch[1].split('\n')) {
      const lm = /:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
      if (lm) msgs.add(lm[1].replace(/\\"/g, '"'));
    }
    void valRe;
  }
  return msgs;
}

describe('rule catalog ↔ rego parity', () => {
  const regoMessages = extractRegoMessages(REGO);
  const catalogMessages = new Set(RULES.map((r) => r.message));

  it('every static (non-sprintf) rego deny message is registered in the catalog', () => {
    const missing: string[] = [];
    for (const msg of regoMessages) {
      if (!catalogMessages.has(msg)) missing.push(msg);
    }
    expect(missing).toEqual([]);
  });

  it('every catalog message exists verbatim in rego (no orphan rules)', () => {
    const orphans: string[] = [];
    for (const msg of catalogMessages) {
      if (!regoMessages.has(msg)) orphans.push(msg);
    }
    expect(orphans).toEqual([]);
  });

  it('catalog has > 20 rules (rulebook is non-trivial)', () => {
    expect(RULES.length).toBeGreaterThan(20);
  });
});
