# LSL: `stripGitGlobalOptions` ate subcommand `-C` (`git switch -C <branch>`)

## Context
LD8 strips git globals (`-C <path>`, `--git-dir`) *before* subcommand classification so `git -C /evil worktree add` still sees `worktree`. The stripper walked the **entire** arg list. `git switch -C feature` / `git branch -C` use `-C` as the subcommand's force-create flag — it got stripped, force checkout looked like a plain switch, allowlist never saw the force.

## Solutions
Stop stripping at the first non-option token (the subcommand). Leading `git -C /repo switch -C feature` → globals stripped, subcommand `-C feature` kept. Catalog also needed `--no-optional-locks` (flag) and `--config-env` (value) or `git --no-optional-locks stash pop` evaded the stash gate.

## Gotchas
- Same flag letter, different grammar: git *global* `-C <path>` vs checkout/switch *subcommand* `-C <branch>`. Path-first vs force-create.
- `--recurse-submodules` on checkout is optional-value — treating it as value-consuming ate the branch name (`git checkout --recurse-submodules feature` skipped classification).

## Ref
src/parser/stripGitGlobalOptions.ts
src/parser/checkoutTarget.ts (FLAGS_WITH_VALUE vs FLAGS_NO_VALUE)
tests/unit/parser/stripGitGlobalOptions.test.ts
