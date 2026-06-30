import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import schemaJson from '../../schemas/decision-output.v1.json' with { type: 'json' };
import type { DecisionOutput } from './DecisionBuilder.ts';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateFn = ajv.compile(schemaJson);

/** Validate a DecisionOutput against decision-output.v1. Throws on invalid. */
export function validateDecision(output: DecisionOutput): void {
  if (!validateFn(output)) {
    const errs =
      validateFn.errors?.map((e) => `${e.instancePath}: ${e.message}`).join('; ') ?? 'unknown';
    throw new Error(`decision-output schema violation: ${errs}`);
  }
}

/** Returns true if valid, false otherwise (no throw). */
export function isValidDecision(output: DecisionOutput): boolean {
  return validateFn(output) === true;
}

export type OutputMode = 'json' | 'claude-code';

/**
 * Formats a decision for emission. Owns the stdout/exit-code strategy [D6][CA2].
 *
 * - `json` mode: always emit the full schema record on stdout.
 * - `claude-code` mode: suppress stdout on allow (Claude Code hook protocol
 *   expects empty stdout for allowed commands); emit JSON only on deny.
 *
 * Exit codes: 0=allow, 2=deny (backward-compat with Claude Code hook protocol).
 */
export class OutputFormatter {
  format(output: DecisionOutput, mode: OutputMode): { stdout: string; exitCode: number } {
    const exitCode = output.decision === 'allow' ? 0 : 2;
    if (mode === 'claude-code' && output.decision === 'allow') {
      return { stdout: '', exitCode };
    }
    return { stdout: JSON.stringify(output), exitCode };
  }
}
