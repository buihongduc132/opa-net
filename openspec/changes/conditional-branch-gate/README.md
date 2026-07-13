# conditional-branch-gate

Add git context/signals support to pi-opa-net so policies can gate git branch operations against protected branches (main/staging/dev/test/master). Extends the input schema and engine to emit `signals.git.{available,current_branch,target_branch}` (cwd is collector context, not a signal), and adds a branch-protection policy rule + tests.
