import { describe, expect, it } from 'bun:test';
import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../schemas/decision-output.v1.json' with { type: 'json' };

/**
 * Hard gate: every example embedded in decision-output.v1.json MUST validate
 * against the schema. The objective explicitly requires 4/4 examples PASS.
 *
 * This test was added after an audit caught 3/4 examples carrying malformed
 * UUIDs (non-hex chars). It prevents regression on the spec contract.
 */
describe('decision-output.v1 — embedded examples', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const examples = schema.examples as Record<string, unknown>[];

  it('schema ships exactly 4 canonical examples', () => {
    expect(examples.length).toBe(4);
  });

  it.each(examples.map((ex, i) => [i + 1, ex]))(
    'example #%d validates against the schema',
    (_i, ex) => {
      const ok = validate(ex);
      expect(ok, `example ${_i} errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    },
  );

  it('example decision_ids are all valid UUIDs (regression guard)', () => {
    for (const ex of examples) {
      const id = ex.decision_id as string;
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('all 4 examples PASS jsonschema.validate (explicit objective criterion)', () => {
    const results = examples.map((ex) => validate(ex));
    expect(results.every((r) => r === true)).toBe(true);
    expect(results.filter((r) => r).length).toBe(4);
  });
});
