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

  // ── cc-safety-net rulebook parity: the 4 new tmux/pkill/killall rules ──
  // These rule IDs (canonical cc-safety-net rulebook names) MUST appear in the
  // catalog once the port is complete. RED until src/rules/catalog.ts is extended.
  describe('cc-safety-net tmux/pkill/killall rule parity', () => {
    const REQUIRED_RULE_IDS = [
      'block-tmux-kill-server',
      'block-tmux-kill-session',
      'block-pkill-tmux-wezterm',
      'block-killall-tmux-wezterm',
    ];

    it('catalog contains all 4 new tmux/pkill/killall rule IDs', () => {
      const catalogIds = new Set(RULES.map((r) => r.ruleId));
      const missing = REQUIRED_RULE_IDS.filter((id) => !catalogIds.has(id));
      expect(missing, `catalog is missing rule IDs: ${missing.join(', ')}`).toEqual([]);
    });

    it('each new tmux/pkill/killall rule maps to a known family', () => {
      const knownFamilies = new Set(RULES.map((r) => r.family));
      const byId = new Map(RULES.map((r) => [r.ruleId, r]));
      for (const id of REQUIRED_RULE_IDS) {
        const rule = byId.get(id);
        expect(rule, `catalog entry for ${id} must exist`).toBeDefined();
        // family is non-empty and registered in the catalog itself
        expect(rule!.family.length).toBeGreaterThan(0);
        expect(knownFamilies.has(rule!.family), `family ${rule!.family} for ${id}`).toBe(true);
      }
    });
  });

  // ── herdr session protection rule parity ──
  describe('herdr session protection rule parity', () => {
    const REQUIRED_RULE_IDS = [
      'block-herdr-server-stop',
      'block-herdr-session-stop',
      'block-herdr-session-delete',
      'block-herdr-workspace-close',
    ];

    it('catalog contains all herdr rule IDs', () => {
      const catalogIds = new Set(RULES.map((r) => r.ruleId));
      const missing = REQUIRED_RULE_IDS.filter((id) => !catalogIds.has(id));
      expect(missing, `catalog is missing rule IDs: ${missing.join(', ')}`).toEqual([]);
    });

    it('each herdr rule maps to family herdr', () => {
      const byId = new Map(RULES.map((r) => [r.ruleId, r]));
      for (const id of REQUIRED_RULE_IDS) {
        const rule = byId.get(id);
        expect(rule, `catalog entry for ${id} must exist`).toBeDefined();
        expect(rule!.family).toBe('herdr');
      }
    });
  });
});
