# conditional-branch-gate

Add context/signals support to pi-opa-net so policies can gate git branch operations against protected branches (main/staging/dev/test/master). Extends the input schema and engine to collect cwd/branch/env signals, starting with git current-branch detection, and adds a policy rule + tests.
