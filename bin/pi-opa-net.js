#!/usr/bin/env bun
/**
 * pi-opa-net — OPA-backed bash command guard with structured --json output.
 *
 * Usage:
 *   pi-opa-net eval "<command>"              # claude-code mode (default)
 *   pi-opa-net eval "<command>" --json        # full schema on stdout always
 *   echo "<command>" | pi-opa-net eval        # read from stdin
 *
 * Exit codes: 0=allow, 2=deny (Claude Code hook protocol compatible).
 */
import { defaultPolicyPath, runCli } from '../src/cli/run.ts';

function parseArgs(argv) {
  const args = argv.slice(2); // drop node + script
  let mode = 'claude-code';
  let command;
  let policyPath = defaultPolicyPath();
  let sawAction = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') {
      mode = 'json';
    } else if (a === '--policy' || a === '-p') {
      policyPath = args[++i];
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
  return { command, mode, policyPath };
}

function printHelp() {
  console.error(`pi-opa-net — OPA-backed bash command guard

Usage:
  pi-opa-net eval "<command>" [--json] [--policy <path>]
  echo "<command>" | pi-opa-net eval

Modes:
  (default)   claude-code: suppress stdout on allow, JSON on deny
  --json      always emit full decision-output.v1 schema on stdout

Exit codes: 0=allow, 2=deny`);
}

async function main() {
  const { command, mode, policyPath } = parseArgs(process.argv);
  const { stdout, exitCode } = await runCli({ command, mode, policyPath });
  if (stdout) {
    console.log(stdout);
  }
  process.exit(exitCode);
}

void main();
