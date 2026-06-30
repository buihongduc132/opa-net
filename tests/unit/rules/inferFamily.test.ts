import { describe, expect, it } from 'bun:test';
import { inferFamilyFromProgram } from '../../../src/rules/index.ts';

describe('inferFamilyFromProgram', () => {
  it('gcloud → gcloud', () => {
    expect(inferFamilyFromProgram('gcloud')).toBe('gcloud');
  });
  it('bq → bq', () => {
    expect(inferFamilyFromProgram('bq')).toBe('bq');
  });
  it('unknown program → custom', () => {
    expect(inferFamilyFromProgram('rm')).toBe('custom');
    expect(inferFamilyFromProgram('xyz')).toBe('custom');
  });
});
