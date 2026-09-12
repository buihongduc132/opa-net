# Explore Turn 2 — rule design + heavy-command list

- Date: 2026-09-09
- Phase: explore
- Status: captured

> **[assistant]**

Grounded. Read the actual rule machinery (`safety.rego` GROUP K + `catalog.ts` + `RuleRegistry.ts`) and enumerated the machine's binaries. Answering as explore — design + list + message, no code.

**Q (verbatim):** "ban all kind of grep / find or any HEAVY cmd from root / and /<1lvl>/<2lvl>; Only be able to these kind of heavy cmd in level 3 and below. Also , make the message to instruct the agent to use eza to find out the directory first before actually doing the recursive search ; LIST all the cmd / tooling in the current machine , all of the one that could do heavy / saturate disk IO / cpu / ram must be BANNED"

---

## 1. The list (actual binaries on this machine — `command -v`)

| Class | Binaries present | Verdict |
|---|---|---|
| Recursive walk/stat — **disk IO** | `find` `du` `rg` `fd` `grep` `egrep` `rgrep` `ls` | BAN (shallow) |
| Recursive lister (discovery) | `eza` (v0.19.3, has `-L/--level`) | **ALLOW** (bounded by `-L`) |
| Raw/bulk IO | `dd` `rsync` `tar` `cp` `mv` `rm` | partial — `dd of=/dev/*` already guarded; `cp/mv/rm -r` = tree ops |
| CPU/RAM | `sort` `wc` `cat` `fzf` `xargs` | BAN when piped from a shallow scan |
| FS check / GUI scan | `fsck` `baobab` | BAN (interactive/heavy) |
| Light (always safe) | `df` `head` `tail` `ls`(no `-R`) | ALLOW |

Absent (no rule needed): `ncdu` `tree` `fdupes` `jdupes` `ag` `ack` `bfs` `locate` `updatedb` `dust` `dua` `gdu` `duf` `ddrescue` `btrfs` `zfs`.

## 2. Depth model

```
/                depth 0   ← BAN heavy scan
├── /var         depth 1   ← BAN (your `du -sh /var` hung 300s here)
│   └── /var/lib depth 2   ← BAN
│       └── /var/lib/docker  depth 3 ✓ ALLOW
├── /home        depth 1   ← BAN (your `du -sh /home` hung here)
│   └── /home/bhd          depth 2   ← BAN (du must NOT start here)
│       ├── .local         depth 3 ✓
│       ├── .pi            depth 3 ✓
│       └── Documents      depth 3 ✓
```

"level 3 and below" = depth ≥ 3. Your own hung commands (`du -xh -d1 /`, `du -sh /home`, `du -sh /var`) all land at depth 0–2 → correctly banned.

## 3. The flow the message must teach

```
want to find what fills / ?
   │
   ▼
eza -T -L 2 /          ← discovery, bounded, ALLOWED
   │   (shows top dirs + their immediate children)
   ▼
du -sh /var/lib/docker   ← depth 3 target, ALLOWED
du -sh /home/bhd/.local  ← depth 3 target, ALLOWED
```

The depth-2 ban only works because `eza -L` fills the gap — enumerate at depth ≤2 with `eza`, then `du`/`find`/`rg` only at depth ≥3.

## 4. Minimal rule (not implemented — design only)

One deny rule, reusing ~90% of existing GROUP K machinery (`program_base`, `is_under_eval_cwd`, `is_known_goal_dir`, `is_cwd_or_relative`):

```
scan_programs   = {find, du, rg, fd}                  # always-heavy
flag_scan       = {grep, egrep, rgrep, ls}            # heavy only with -r/-R
path_depth(p)   = count(non-empty split(p, "/"))
shallow(p)      = absolute AND depth <= 2
deny := scan_program AND shallow AND not(under cwd / known-goal / relative)
```

Message (the deliverable you asked for):

> "Recursive scan (`find`/`du`/`rg`/`fd`/`grep -r`/`ls -R`) on `/` or a 1–2 level path is blocked — full-tree IO saturates the disk and hangs. Discover first with `eza -T -L 2 <dir>`, then scan a specific ≥3-level target (e.g. `/var/lib/docker`, `/home/bhd/.local`). Unlock: `block-shallow-heavy-scan`."

Landing surface (3 files, parity-test enforced): `policy/safety.rego` (GROUP L), `src/rules/catalog.ts` (new `scan` family entries), `src/rules/RuleRegistry.ts` (extend `RuleFamily` union).

**Callouts [CA]:**
- `rg` is always-recursive (no flag gate) — must be in the always-heavy set, unlike `grep`.
- `eza` must stay ALLOWED at shallow depth, else the discovery step is impossible and the rule deadlocks.
- `sudo du` is the same program — the guard must key on `program_base`, not path (already the pattern).
- `/home/bhd` (depth 2) becoming banned changes YOUR existing habit of `du -sh /home/bhd` — intended, but the habit must switch to per-child depth-3 targets.

Want this captured as a change? → `/opsx:new` (scaffold) or `/opsx:ff` (all artifacts).

Status at end of turn 2: rule designed (depth-gated, GROUP K reuse). Binaries enumerated. 4 callouts raised. → Next: turn 3.
