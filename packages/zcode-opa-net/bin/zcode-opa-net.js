#!/usr/bin/env bun
/**
 * zcode-opa-net — OPA-backed bash command guard with structured --json output.
 *
 * Usage:
 *   zcode-opa-net eval "<command>"              # claude-code mode (default)
 *   zcode-opa-net eval "<command>" --json        # full schema on stdout always
 *   zcode-opa-net eval "<command>" --unlock <key>  # present unlock key
 *   echo "<command>" | zcode-opa-net eval        # read from stdin
 *   zcode-opa-net unlock-key <rule_id>           # mint long-lived key
 *   zcode-opa-net unlock-key <rule_id> --ttl 3600 # mint TTL key
 *   zcode-opa-net unlock-key --list              # list unlockable rule_ids
 *
 * Exit codes: 0=allow, 2=deny (Claude Code hook protocol compatible).
 */
import { defaultPolicyPath, runCli } from '../src/cli/run.ts';
import { listUnlockableRules, mintUnlockKey } from '../src/cli/unlock-key.ts';
import { configFromEnv } from '../src/config/Config.ts';

function parseArgs(argv) {
  const args = argv.slice(2); // drop node + script
  let mode = 'claude-code';
  let command;
  let policyPath = defaultPolicyPath();
  let sawAction = false;
  const unlockKeys = [];
  let unlockStdin = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') {
      mode = 'json';
    } else if (a === '--policy' || a === '-p') {
      policyPath = args[++i];
    } else if (a === '--unlock') {
      unlockKeys.push(args[++i]);
    } else if (a === '--unlock-stdin') {
      unlockStdin = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith('-')) {
      // First positional is the action verb ('eval'); subsequent ones form the command.
      if (!sawAction && a === 'eval') {
        sawAction = true;
      } else {
        command = command === undefined ? a : `${command} ${a}`;
      }
    }
  }
  return { command, mode, policyPath, unlockKeys, unlockStdin };
}

function printHelp() {
  console.error(`zcode-opa-net — OPA-backed bash command guard

Usage:
  zcode-opa-net eval "<command>" [--json] [--policy <path>] [--unlock <key> ...]
  echo "<command>" | zcode-opa-net eval
  zcode-opa-net unlock-key <rule_id> [--ttl <sec>]
  zcode-opa-net unlock-key --list

Modes:
  (default)   claude-code: suppress stdout on allow, JSON on deny
  --json      always emit full decision-output.v1 schema on stdout

Unlock:
  --unlock <key>        Present an unlock key (repeatable)
  --unlock-stdin        Read a single key from stdin (requires positional command)
  PIOPANET_UNLOCK_KEYS  Comma-separated keys via env var

Exit codes: 0=allow, 2=deny`);
}

/**
 * Dispatch the unlock-key subcommand.
 * Returns exit code; never throws (prints error to stderr).
 */
function runUnlockKey(subArgs) {
  // Parse sub-args: --list, --ttl <sec>, or <rule_id>
  let ruleId;
  let ttlSec;
  for (let i = 0; i < subArgs.length; i++) {
    const a = subArgs[i];
    if (a === '--list') {
      for (const id of listUnlockableRules()) {
        console.log(id);
      }
      return 0;
    }
    if (a === '--ttl') {
      ttlSec = Number.parseInt(subArgs[++i], 10);
    } else if (!a.startsWith('-')) {
      ruleId = a;
    }
  }

  if (!ruleId) {
    console.error('error: unlock-key requires a rule_id argument (or --list)');
    return 1;
  }

  try {
    const config = configFromEnv(defaultPolicyPath());
    const key = mintUnlockKey({
      ruleId,
      saltPath: config.unlockSaltPath,
      ttlSec,
    });
    console.log(key);
    return 0;
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 1;
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // Dispatch unlock-key subcommand.
  if (rawArgs[0] === 'unlock-key') {
    const exitCode = runUnlockKey(rawArgs.slice(1));
    process.exit(exitCode);
  }

  const { command, mode, policyPath, unlockKeys, unlockStdin } = parseArgs(process.argv);
  try {
    const { stdout, exitCode } = await runCli({
      command,
      mode,
      policyPath,
      unlockKeys,
      unlockStdin,
    });
    if (stdout) {
      console.log(stdout);
    }
    process.exit(exitCode);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

void main();
