# Code Context — GROUP J (DevOps destructive-CLI coverage)

## Files Retrieved
1. `policy/safety.rego` (full, 652 lines) — deny-rule conventions; GROUP B table at 191-204, GROUP C at ~213-250, GROUP I at 504-555, next insertion point before line 556 (branch-target-allowlist "GROUP G" reuse).
2. `src/rules/catalog.ts` (full, 318 lines) — RULES array (mirrors rego messages verbatim); `inferFamilyFromProgram` at 299-315.
3. `src/rules/RuleRegistry.ts` (full, 110 lines) — `RuleFamily` union at 3-18; message-keyed registry with familyHint collision resolution (76-96).
4. `src/parser/ShellQuoteParser.ts` (full, 84 lines) — `SUBCOMMAND_PROGRAMS` at line 12; classify() at 53-72.
5. `src/parser/RegexFallbackParser.ts` (full, 31 lines) — mirrored `SUBCOMMAND_PROGRAMS` at line 4 (comment: "mirror of ShellQuoteParser's set").
6. `schemas/decision-output.v1.json` (95-115) — family enum at line 103.
7. `tests/unit/rules/catalog-parity.test.ts` (full, 141 lines) — `extractRegoMessages` Form 1/Form 2 at 21-45; Form 2 regex is NAME-HARDCODED to `docker_blocked_subcommands` (line 32).
8. `tests/e2e/e2e.test.ts` (full, 313 lines) — `DENY_CASES` (75-173), `ALLOW_CASES` (175-192), coverage threshold at ~281 (`fired.size >= 17` absolute, comment "41 catalog rules → 40% = 17").
9. `tests/unit/rules/inferFamily.test.ts` — extendable mapping assertions, no count.
10. `tests/unit/parser/CommandParser.test.ts` — parser behavior pins (subcommand vs flat), no docker-compose case.

## 1. Exact touch points for a new GROUP J

| File | Line | Change |
|---|---|---|
| `policy/safety.rego` | after 555 (end of GROUP I, before reused "GROUP G" header at ~556) | GROUP J deny rules |
| `src/rules/catalog.ts` | inside `RULES` (~after line 258, pulumi block) | one RuleMeta per rule, message byte-identical to rego |
| `src/rules/catalog.ts` | 299-315 | `inferFamilyFromProgram` cases ONLY if using sprintf/dynamic messages (gcloud precedent) |
| `src/rules/RuleRegistry.ts` | 3-18 | extend `RuleFamily` union (e.g. `| 'terraform' | 'nomad' | 'aws' | 'devops'`) |
| `schemas/decision-output.v1.json` | 103 | extend family enum — MUST match RuleRegistry union |
| `src/parser/ShellQuoteParser.ts` | 12 | add subcommand-shaped programs |
| `src/parser/RegexFallbackParser.ts` | 4 | mirror the SAME set (both sets must stay identical) |
| `tests/unit/rules/catalog-parity.test.ts` | 21-45 | only if new `*_blocked_subcommands`-style tables are added (see §2) |
| `tests/e2e/e2e.test.ts` | DENY_CASES/ALLOW_CASES | `{command, ruleId, family}` denies + `{command}` allows |

**Conventions (from GROUP B/C/I):**
- **Message parity is HARD**: `catalog-parity.test.ts` extracts every literal `msg := "..."` from rego AND every value in `docker_blocked_subcommands`, then asserts set equality both directions with catalog messages. Any literal deny message must exist byte-identical in both files.
- **sprintf messages** (gcloud/bq style) are excluded from parity by design; family then comes from `inferFamilyFromProgram(parsed.program)` (DecisionBuilder.ts:168, 205). Tradeoff: sprintf rules get synthesized `custom:<hash>` rule_ids unless registered — bad for unlock-key ergonomics (LD-L1: one rule = one key, key minting uses `RULES` ruleId at `src/cli/unlock-key.ts:47`).
- **e2e coverage test** asserts absolute `fired.size >= 17` — adding rules lowers % but the absolute bar still passes; no break.

## 2. GROUP B shared-table pattern

```rego
docker_blocked_subcommands := {          # safety.rego:191
    "stop": "Direct container stop is blocked...",
    ...
}
deny[msg] if {                            # safety.rego:201
    input.program == "docker"
    input.subcommand in object.keys(docker_blocked_subcommands)
    msg := docker_blocked_subcommands[input.subcommand]   # :204 — dynamic msg
}
```

**Key constraint**: the parity test Form 2 regex is `/docker_blocked_subcommands\s*:?=\s*\{([\s\S]*?)\n\}/` — it ONLY extracts values from a table literally named `docker_blocked_subcommands`. A new `terraform_blocked_subcommands` table's values would NOT be extracted → catalog entries for those messages would fail the "no orphan rules" direction (catalog message not found in extracted rego set) → **test breaks**.

**Fit for GROUP J tables** — YES, but requires one additive test change: generalize Form 2 to `/(\w+_blocked_\w+)\s*:?=\s*\{([\s\S]*?)\n\}/`. That is an extension honoring parity, not a strip. Proposed tables:
- `terraform_blocked_subcommands` — keys: destroy, force-unlock? (decide), covers tofu/terragrunt via same deny rule body (3 programs, 1 table, `input.program in {"terraform","tofu","terragrunt"}`).
- `nomad_blocked_subcommands` — job/alloc/system/node verbs.
- `aws_blocked_verbs` — flat any-arg matching (gcloud GROUP D precedent, safety.rego:231-240).
- `service_manager_blocked_verbs` — pm2/systemctl shared kill verbs (pm2 kill/delete/stop, systemctl stop/kill/mask/disable) — GROUP H herdr two-token style (`has_any_arg` pairs) is the closer precedent since pm2/systemctl are flat.

Whole-subcommand blocks → table; flag-combination rules (terraform apply -auto-approve, terragrunt run -- --auto-approve) → literal `msg := "..."` deny rules (pulumi GROUP I style) — literals need zero test change.

## 3. docker-compose v1 binary bypass — CONFIRMED

- Parser: `docker-compose` ∉ `SUBCOMMAND_PROGRAMS` (both parser files) → `parse("docker-compose --project-name=litellm down")` = `{program:"docker-compose", subcommand:"", args:["--project-name=litellm","down"]}`.
- GROUP C (safety.rego:224-249) requires `input.program == "docker" && input.subcommand == "compose"` → **never fires. Full bypass of all litellm carve-outs.** Binary exists on this machine: `/usr/bin/docker-compose`.
- Adding `docker-compose` to SUBCOMMAND_PROGRAMS does NOT fix the flag-first form: classify() skips subcommand extraction when tokens[1] starts with `-` (ShellQuoteParser.ts:68) → subcommand stays "" for `docker-compose --project-name=litellm down`. It WOULD catch `docker-compose down --project-name=litellm`.
- **Minimal fix (recommended)**: treat `docker-compose` as flat-arg shaped — no parser change. Add GROUP C-parity rego rule: `input.program == "docker-compose"` + `has_any_arg(args, ["down","rm"])`/`has_arg_prefix(args, litellm_targets)` (reuse existing `litellm_projects`/`litellm_targets` consts) + literal messages (add 1-3 new catalog entries, family `docker`), + `case 'docker-compose': return 'docker'` in `inferFamilyFromProgram` (needed only if reusing the existing GROUP C messages which are already registered with family docker — reuse same literal strings → zero new catalog entries beyond optional alias, and lookup by message works since familyHint narrows correctly). Zero existing-test breakage.
- Alternative (rejected): normalize program `docker-compose`→`docker`+subcommand `compose` in parser. Changes echoed `input.program`, newly applies GROUP B (docker stop-class rules) to docker-compose v1 — arguably correct but behavior-changing beyond the carve-out scope; flag-first forms still need args-level rules.

## 4. Subcommand-shaped vs flat-arg-shaped (per existing convention)

| CLI | Shape | Rationale / precedent |
|---|---|---|
| terraform | SUBCOMMAND (add to set) | `terraform destroy`, `terraform apply` — token[1]=verb; nested `state rm` → subcommand=state, "rm" in args (pulumi GROUP I precedent) |
| tofu | SUBCOMMAND | same grammar as terraform (NOT installed on this machine — cover for parity, no local test-binary risk) |
| terragrunt | SUBCOMMAND | `terragrunt destroy` / `terragrunt run destroy` — run-as-subcommand means nested verbs land in args (terraform-table + arg rules) |
| nomad | SUBCOMMAND | `nomad job stop` → subcommand=job, "stop" in args (GROUP B `docker volume rm` precedent at safety.rego:206-214) |
| consul | SUBCOMMAND | `consul kv delete` → subcommand=kv |
| vault | SUBCOMMAND | `vault kv delete` → subcommand=kv; `vault operator raft remove-peer` → subcommand=operator |
| aws | FLAT (verb-anywhere) | nested verbs at varying depth (`aws ec2 terminate-instances`, `aws s3 rm`) — gcloud GROUP D precedent exactly |
| pm2 | FLAT | herdr GROUP H precedent: two-token `has_any_arg` pairs ("kill"/"delete"/"stop" anywhere in args) |
| systemctl | FLAT | same as pm2 (verbs stop/kill/mask/disable); unit names are user-controlled strings — verb-anywhere with high-specificity verbs is safe |
| dd | FLAT | `dd of=/dev/sdX` — deny on `has_arg_prefix(args, ["of=/dev/"])` (block-device writes); writes to regular files allowed |

## 5. Tests that hardcode counts/enums (break-risk on family adds)

- **None hardcode family counts or full enum lists.** Verified:
  - `catalog-parity.test.ts`: only `RULES.length > 20` (safe) + explicit ruleId lists (additive).
  - `e2e.test.ts:281`: absolute `>= 17` fired rules (safe; comment "41 catalog rules" is prose).
  - `tests/unit/schema/decision-output.unlock.test.ts`: uses family `'git'` fixtures only (enum additions safe).
  - `tests/unit/rules/inferFamily.test.ts`: point mappings, extendable.
  - Unlock key minting (`src/cli/unlock-key.ts:47`) derives from `RULES` dynamically — new rules auto-unlockable, no hardcoded list.
- Only true enum duplication: `RuleFamily` union (RuleRegistry.ts:3) ↔ schema enum (decision-output.v1.json:103) — keep in sync manually.
- AGENTS.md prose says "42-rule catalog" — stale count, cosmetic only.

## 6. Machine inventory (verified via `which`/mise)

Installed: `terraform` (~/bin), `terragrunt` (~/.local/bin), `nomad`, `consul` (/usr/bin), `vault` (~/bin), `aws` (~/bin + mise awscli 2.33.21), `pm2` (mise node), `systemctl` (/usr/bin), `dd` (/usr/bin), `docker-compose` v1 (/usr/bin). **`tofu` NOT installed** (only tftui).

### Deny / allow inventory

**terraform / tofu / terragrunt**
- DENY: `destroy` (any); `apply` + [`-auto-approve`, `-auto-approve=approved`/`-y`]; `state rm`; `state delete`; `workspace delete`; terragrunt `run` + [`destroy`, `apply -- --auto-approve`].
- ALLOW: `plan`, `show`, `validate`, `output`, `providers`, `graph`, `state list`, `state show`, `state pull`, `workspace list`, `workspace select`, terragrunt `hclfmt`, `validate-inputs`, terragrunt bare `plan`.

**nomad**
- DENY: `job` + [`stop`, `deregister`]; `alloc` + [`stop`, `signal`, `restart`]; `system gc`; `node` + [`drain`, `eligibility -disable`]; `deployment` + [`fail`, `pause`]; `volume` + [`detach`].
- ALLOW: `job status|inspect|plan|run|scale`, `status`, `alloc status|logs`, `node status`, `monitor`, `agent info` (job run stays allowed — it is the standard Nomad deploy path on this machine).

**consul**
- DENY: `kv` + [`delete`, `delete -recurse`]; `services deregister`; `leave`/`force-leave`; `operator raft remove-peer`; `acl` delete-class verbs.
- ALLOW: `kv get`, `kv get -recurse`, `members`, `services list`, `catalog` reads, `info`, `watch`.

**vault**
- DENY: `kv` + [`delete`, `destroy`]; `secrets disable`; `auth disable`; `lease revoke -prefix`; `token revoke`; `operator raft remove-peer`; `seal`.
- ALLOW: `kv get`, `kv list`, `status`, `read`, `list`, `secrets list`, `auth list`, `token lookup`, `operator raft list-peers`.

**aws** (flat verb table, high-specificity multiword verbs)
- DENY tokens: `terminate-instances`, `stop-instances`, `delete-bucket`, `delete-stack`, `delete-table`, `delete-db-cluster`, `delete-log-group`; `s3 rm` / `s3 rb` (require "s3" AND "rm"/"rb" co-present — two-token herdr style).
- ALLOW: `sts get-caller-identity`, `s3 ls`, `ec2 describe-*`, `logs tail`, all `describe-*`/`list-*`/`get-*`.

**pm2**
- DENY: `kill`, `delete`, `stop`, `restart` (service-kill verbs; pm2 hosts prod services here).
- ALLOW: `list`, `jlist`, `status`, `describe`, `logs --nostream`, `monit`.

**systemctl**
- DENY: `stop`, `kill`, `mask`, `disable`, `isolate` (user-controlled unit names — verb set only).
- ALLOW: `status`, `show`, `cat`, `is-active`, `is-enabled`, `list-units`, `list-unit-files`, `daemon-reload`.

**dd**
- DENY: any arg with prefix `of=/dev/` (raw block-device overwrite).
- ALLOW: `of=/tmp/...`, `of=./file.img`, reads (`if=`) always.

## 7. Implementation approaches (2+)

**Approach A — literal per-rule deny (GROUP A/F/I style)**
One `deny[msg]` per combo with literal message; matching catalog entries.
- Pros: zero parity-test change; stable per-rule ruleIds (best for LD-L1 unlock keys); family resolution from catalog directly (no inferFamilyFromProgram additions except docker-compose); maximal message granularity.
- Cons: ~25-35 near-duplicate rego blocks; verbose; per-CLI message drift risk.

**Approach B — shared tables (GROUP B/D style) + generalized parity extractor** (recommended)
`terraform_blocked_subcommands`, `nomad_blocked_verbs`, `aws_blocked_verbs`, `service_manager_blocked_verbs` tables + `deny[msg]` with `msg := table[...]`; flag-combos (apply -auto-approve) as literal rules; extend `extractRegoMessages` Form 2 regex from name-hardcoded `docker_blocked_subcommands` to generic `\w+_blocked_\w+`.
- Pros: DRY (terragrunt+tofu+terraform share one table via `input.program in {...}`); adding verbs = one line; test change is additive (extracts MORE, honors parity).
- Cons: requires parity-test edit (small, must keep docker extraction working); dynamic msg → lookup needs catalog registration of each table value anyway (parity forces it — fine).

**Approach C — sprintf dynamic messages + inferFamilyFromProgram (gcloud/bq style)**
- Pros: no parity coupling at all; smallest catalog.
- Cons: rule_ids become `custom:<hash>` → unlock-key UX degrades (LD-L1 one-rule-one-key requires registered ids); messages lose specificity. NOT recommended for GROUP J.

**Family strategy**: either per-CLI families (`terraform`, `nomad`, `aws`, ...) — bloats enum/union ×5-7 — or one `devops` family (or `iac` + `ops` split). With unique literal/table messages, family comes from catalog; only `docker-compose` needs an `inferFamilyFromProgram` case (→ `docker`).

## Start Here
`policy/safety.rego` (GROUP B 191-250 for table+literal pattern, GROUP I 504-555 for flag-combo pattern) then `tests/unit/rules/catalog-parity.test.ts` — the parity extractor is the one piece that gates the table approach.
