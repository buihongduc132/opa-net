# Support

## Getting help

- **Bugs & feature requests:** [GitHub Issues](https://github.com/buihongduc132/pi-opa-net/issues)
- **Security reports:** see [SECURITY.md](SECURITY.md) — do **not** use public issues for vulnerabilities
- **Source:** [github.com/buihongduc132/pi-opa-net](https://github.com/buihongduc132/pi-opa-net)

## Before filing an issue

Please gather:

1. **pi-opa-net version** — `bunx pi-opa-net --help` or check `package.json`
2. **OPA version** — `opa version`
3. **The exact command you evaluated** and the decision output (`--json`)
4. **Reproduction steps** — minimal as possible
5. **Expected vs actual behavior**

## Common issues

### `opa: command not found` / `source: fail-open`

OPA is not on `PATH`. Install it:

```bash
mise install opa@latest && mise use -g opa@latest
# or download from https://www.openpolicyagent.org/downloads
```

Or point at an explicit binary:

```bash
PI_OPA_BINARY=/path/to/opa bunx pi-opa-net eval "git stash pop"
```

### A rule I expected to fire did not

Check [`src/rules/catalog.ts`](src/rules/catalog.ts) for the exact message string and [`policy/safety.rego`](policy/safety.rego) for the match conditions. The parser is program-aware — `git`/`docker`/`gh`/`glab` use a subcommand shape; `rm`/`bd`/`gcloud`/`bq` put everything after the program in `args`.

### `decision: allow` when I expected `deny` with `source: fail-open`

OPA was unreachable within `PI_OPA_TIMEOUT_MS` (default 250ms). Raise the timeout or switch to fail-closed:

```bash
PI_OPA_TIMEOUT_MS=2000 PI_OPA_FAIL_MODE=closed bunx pi-opa-net eval "git stash pop"
```
