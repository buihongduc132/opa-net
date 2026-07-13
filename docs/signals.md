# Context Signals

Context signals are structured environment facts gathered at decision time and
surfaced on the decision record alongside the parsed command. They let the
policy (Rego) make decisions that depend on facts OPA itself cannot observe —
for example, the *current* git branch.

> Added by the `conditional-branch-gate` change. See
> `docs/open-threads.yaml` (OT5) and `docs/locked-decisions.yaml`.

## The `input.signals` contract

Every decision passes the collected signals to OPA under `input.signals`:

```jsonc
input = {
  program:    "git",
  subcommand: "checkout",
  args:       ["feature"],
  raw:        "git checkout feature",
  signals: {
    git: {
      available:      true,            // false ⇒ branch-protection rule skips (fail-open)
      current_branch: "main",          // null in a non-repo or when git is missing
      target_branch:  "feature"        // parsed checkout/switch target; null for flags/no-arg
    }
  }
}
```

### Fail-open guarantee

Every signal collector MUST be total: it returns `{ available: false, ... }` on
any error (non-repo, detached HEAD, missing git, ENOENT) instead of throwing.
`collectAll` additionally suppresses any thrown exception into
`{ available: false }`. A deny rule that keys off `signals.<name>.available`
therefore never blocks the decision when the environment is unobservable.

### Non-git commands

For commands that are not `git checkout`/`git switch`, the CLI emits an empty
`signals` object (`signals: {}`) — `signals.git` is absent. The
branch-protection Rego rule treats an absent `input.signals.git` as undefined,
so the rule body fails and never fires.

## Built-in collectors

| Name | Module | Source of fact |
|------|--------|----------------|
| `git` | `src/signals/GitSignals.ts` | shells `git rev-parse --abbrev-ref HEAD` in the decision cwd |
| `—`   | `src/signals/collectAll.ts` | merges an array of collectors into one `Signals` object |

`GitSignals` also exposes `parseGitTargetBranch(subcommand, args)` — the
branch-name-agnostic parser that isolates the target token from
`git checkout/switch <branch>` while ignoring flags (`-b`, `-`, `--track`, …).

## Adding a new signal

1. Implement the `SignalCollector` interface in `src/signals/types.ts`:

   ```ts
   export interface SignalCollector {
     name: string;                                  // stable key under input.signals
     collect(ctx: SignalContext): Record<string, unknown>;  // NEVER throw
   }
   ```

2. Create `src/signals/<Name>.ts` exporting your class. Fail-open on every error.

3. Wire it into the CLI pipeline in `src/cli/run.ts`:

   ```ts
   const signals = collectAll(
     [new GitSignals(), new YourCollector()],
     { cwd: process.cwd(), raw, parsed },
   );
   ```

4. (Optional) Author a Rego rule in `policy/safety.rego` keyed on
   `input.signals.<name>.<field>`. Guard with existence checks so the rule
   fails open when the signal is absent.

5. The `signals` field on `decision-output.v1.json` is intentionally open
   (`additionalProperties: { type: object }`) so new collectors require no
   schema change.
