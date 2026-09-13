import { programBasename } from './unwrapShellDashC.ts';

/**
 * Wrapper commands that prepend the real program (gotcha wrapper-unwrap,
 * plan ban-shallow-heavy-scan). `sudo du -sh /` must classify as `du`, not
 * `sudo` — otherwise every program_base-keyed rule is defeated by a prefix.
 *
 * Value-taking flags per wrapper (`sudo -u <user>`, `env -u <var>`,
 * `nice -n <n>`, `timeout -k <t>`, `ionice -c <n>`) consume the NEXT token.
 * `env` also skips `VAR=value` assignments.
 * `timeout` skips ONE duration positional (`timeout 30 du …`) after flags.
 *
 * Unwrapping is repeated (`nice sudo du …`). If unwrapping would consume
 * every token (`env` alone, `sudo` with no command), the ORIGINAL tokens are
 * returned unchanged — the wrapper itself is then the (harmless) program.
 */
const WRAPPERS: ReadonlySet<string> = new Set([
  'sudo',
  'env',
  'nice',
  'nohup',
  'time',
  'timeout',
  'stdbuf',
  'ionice',
]);

/** Flags whose value arrives as the NEXT token (per wrapper). */
const VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '-g', '-p', '-U', '-r', '-t', '-C', '-D']),
  env: new Set(['-u']),
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-k', '-s', '--signal', '--kill-after', '--preserve-status']),
  stdbuf: new Set(['-o', '-e', '-i']),
  ionice: new Set(['-c', '-n', '-t']),
  nohup: new Set(),
  time: new Set(),
};

const DURATION_RE = /^\d+(\.\d+)?[smhd]?$/;
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function unwrapWrapperTokens(tokens: readonly string[]): string[] {
  const out = [...tokens];
  let unwrappedSomething = false;

  for (;;) {
    const wrapper = programBasename(out[0] ?? '');
    if (!WRAPPERS.has(wrapper)) break;
    let i = 1;

    if (wrapper === 'env') {
      while (i < out.length) {
        const t = out[i];
        if (ENV_ASSIGN_RE.test(t)) {
          i++;
          continue;
        }
        if (t.startsWith('-')) {
          i += VALUE_FLAGS.env.has(t) ? 2 : 1;
          continue;
        }
        break;
      }
    } else {
      while (i < out.length && out[i].startsWith('-') && out[i] !== '--') {
        i += VALUE_FLAGS[wrapper]?.has(out[i]) ? 2 : 1;
      }
      if (out[i] === '--') i++;
      if (wrapper === 'timeout' && out[i] && DURATION_RE.test(out[i])) i++;
    }

    if (i >= out.length) break; // wrapper with no command — keep as-is
    out.splice(0, i);
    unwrappedSomething = true;
  }

  return unwrappedSomething ? out : [...tokens];
}
