import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Compute a SHA-256 hex prefix of file content for rulebook drift detection.
 * @param path     file path to hash
 * @param reader   optional reader override (testability)
 * @returns first 12 hex chars, or 12 zeros if unreadable
 */
export function sha256Prefix(path: string, reader?: (p: string) => string): string {
  const read = reader ?? ((p: string) => readFileSync(p, 'utf8'));
  try {
    const content = read(path);
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
  } catch {
    return '0'.repeat(12);
  }
}
