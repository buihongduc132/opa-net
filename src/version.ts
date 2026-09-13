/**
 * Package version — read once from package.json at module load.
 *
 * Used in decision metadata and audit entries so every trace/log line
 * carries the exact pi-opa-net version that produced it. This enables
 * after-the-fact version correlation when debugging audit trails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let _version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
  _version = pkg.version ?? 'unknown';
} catch {
  // Non-fatal — version stays 'unknown' if package.json is unreachable.
}

/** The pi-opa-net package version (e.g. "0.4.0"). */
export const PI_OPA_NET_VERSION: string = _version;
