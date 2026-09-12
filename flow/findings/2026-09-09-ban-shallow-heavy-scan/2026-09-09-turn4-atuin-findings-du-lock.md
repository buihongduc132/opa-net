# Explore Turn 4 — atuin habit check + du lock

- Date: 2026-09-09
- Phase: explore
- Status: captured

> **[assistant]**

**LD4 lock — du → depth 3.** User: "For DU , depth 3". Interpreted as `du` allowed at depth ≥3 (banned at depth 0/1/2), consistent with turn-2 depth model. Recorded in locked-decisions.yaml.

## atuin past-habit check

**Correction on the atuin skill:** `atuin-history` SKILL.md documents `--author`/`--authors` flags. Installed atuin version does NOT have them. Actual flags (from `atuin search --help`):

```
-c, --cwd <CWD>              Filter by directory
-e, --exit <EXIT>            Filter by exit code
-b, --before <BEFORE>        Only results before date
    --after <AFTER>          Only results after date
    --limit <LIMIT>          Max entries
    --cmd-only               Show only command text
    --search-mode <MODE>     prefix|fulltext|fuzzy|daemon-fuzzy
```

**7-day window (`--after 2026-09-02`) — what actually got found:**

| Query | Result |
|---|---|
| `du ` | **0 direct hits** (empty) |
| `find ` | only `agy -i "...find..."` prompt text — the WORD "find" inside agent prompts, **0 actual `find` invocations** |
| `grep -r` | only `agy -i` prompt text + `pi --session`/`pi --fork` launch commands |
| `rg ` | only `agy -i` prompt text + `pi --session`/`pi --fork` launch commands + `mise run cockpit:rotate` |

Representative verbatim sample (find query, 7d):

```
agy -i "> Find the plans related to outbox: browser , the worktree  directory  as mount , the  building  layer , all of the heavy stuffs into. ..."
agy -i "check ps aux , then also find the ralph runing in the current projects , is it having multiple duplicated run? ..."
pi --session /home/bhd/.pi/agent/sessions/--home-bhd-Documents-Projects-bhd-pi-plugins--/2026-09-03T11-18-16-445Z_....jsonl
```

## Conclusion [C1]

Heavy scans (`du`/`find`/`rg -r`) are run **inside** agent sessions (pi/agy/codex) via their bash tool — they do **NOT** appear in atuin shell history. Atuin only records the agent-launch wrappers (`pi --session`, `agy -i`, `pi --fork`).

Evidence of the actual habit lives in **session transcripts**, not atuin — e.g. turn-1's transcript shows `du -xh -d1 /` timing out at 300s. atuin = L2 (launch wrappers only), transcripts = L1 (real commands).

**Implication for the rule:** the guard MUST live at the agent tool-call path (opa-net / pi-opa-net hook intercepting `bash`), NOT shell aliases or atuin. Shell-level guards would never fire because the heavy commands never enter the interactive shell.

Status at end of turn 4: du locked (LD4). atuin habit = agent-internal (guard at hook). → Next: `/10-plan-declarative` then `/gotcha-coverage`.
