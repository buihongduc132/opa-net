# Gotcha Coverage — ban-shallow-heavy-scan

> Source: flow/plans/ban-shallow-heavy-scan.md
> Mode: plan
> Sub-agents: reviewer ×3 (batches: rego items 1–5 · ts items 6–10 · tests item 11)
> Units reviewed: 11 plan items + DOD

## Findings (ranked, deduped across 3 batches — batch provenance tagged)

### Rank 5 (Sophisticated / fundamental)

- **G5.1 — Literal path depth is bypassable (`..`/`~`/`$HOME`/empty-arg/glob)**
  - What: `path_depth` counts raw `split(p,"/")` segments verbatim. `du -sh /var/lib/..` → "depth 3" → allowed though it resolves to `/var` (depth 1). `du -sh ~`, `du -sh $HOME` are not absolute → never denied; shell-quote expands bare `$HOME` to EMPTY arg (GROUP K documented caveat). Globs, `//`, `/./`, trailing `/` all miscount.
  - Why missed: depth modeled as string property; no normalization item; no raw-token fallback item.
  - Severity: rule bypassable while tests stay green.
  - Mitigation: normalize `.`/`..`/`//`/trailing-`/` lexically before counting; add `~`/`$HOME`/`${HOME}`/`/home/<user>` equivalence + raw-token deny rule mirroring GROUP K (`find_raw_home_token` pattern). [rego G1/G3, ts G6, tests G1]

- **G5.2 — rg / fd / rgrep are recursive by default or by name**
  - What: item 1 puts `rgrep` in the flag-gated set and implies `rg`/`fd` need flags. `rgrep` IS `grep -r` (no flag); `rg x /` and `rg --files /` and `fd` do full-tree walks with zero recursion flags.
  - Why missed: flag-gate design assumed opt-in recursion.
  - Severity: deny can never fire for the default-recursive tools → bypass.
  - Mitigation: move `rg`, `fd`, `rgrep` to always-heavy; grep/egrep/ls stay flag-gated (`-r`/`-R`/`--recursive`/`--tree`). [ts G2, tests G2, rego G2]

- **G5.3 — target depth is the wrong IO proxy for `du`**
  - What: `du` always walks the ENTIRE subtree. Allowed `/var/lib/docker` (68GB) is heavier than banned `/var`. Depth bans prefixes while allowing the largest subtrees.
  - Why missed: plan equates "shallow depth = heavy IO"; for du/find the real proxy is subtree size.
  - Severity: rule fails its own intent (prevent IO saturation).
  - Mitigation: gate on IO-bounding flags (`du -d N`, `find -maxdepth N`, `rg/fd --max-depth N`, `-x`); treat depth as deny-class ONLY when no depth-cap flag present. [ts G1]

- **G5.4 — relative `.` paths have no depth → `cd / && du -sh .` bypass + repo false-positives**
  - What: depth computable only for absolute paths. `.` at `/` is the banned scan; `.` in a repo is the common legitimate command. No cwd-resolution item despite `signals.env.cwd` seam existing.
  - Why missed: "cwd-relative exempt" stated flatly; cwd never resolved to a depth.
  - Severity: trivial bypass or mass false-positives — no third option without explicit semantics.
  - Mitigation: resolve `.`/relative against cwd signal; deny if resolved depth ≤2; document residual. [rego G3, ts G3, tests G3]

### Rank 4 (Significant)

- **G4.1 — blanket eza exemption → `eza -T /` is unbounded full-tree walk**
  - What: `eza -T` without `-L` recurses to bottom — exactly the banned class. Message recommends `-L 2` but rule doesn't enforce.
  - Mitigation: exempt eza ONLY when `-L/--level N` (N≤2) present, else deny. [rego G4/G9, ts G7]

- **G4.2 — cwd/cwd-relative exemption = `cd` bypass**
  - What: `cd / && du -sh .` → relative → exempt → allowed. `eval_cwd` itself may be depth ≤2.
  - Mitigation: exemption only when resolved cwd depth ≥3. [rego G5, tests G10]

- **G4.3 — no-path-arg default-cwd scan**
  - What: `grep -r foo` / `rg pattern` / `find` default to cwd recursive. cwd=`/` → heavy scan exempt via cwd-relative.
  - Mitigation: bare recursive + unknown/shallow cwd → deny or require explicit path. [tests G2]

- **G4.4 — recursion-flag dimension absent**
  - What: matrix varies path depth only. `ls /etc` (non-recursive shallow, allowed?) vs `eza --tree /` (recursive, denied?) untested → both error classes invisible.
  - Mitigation: add shallow-but-non-recursive allow cases + recursive-flag shallow deny cases. [tests G4]

- **G4.5 — depth-cap flags not exempted → bans the canonical triage command**
  - What: `du -d 1 /` and `find / -maxdepth 1` are bounded and LIGHTER than prescribed `eza -T -L 2 /`, yet banned. `du -d 1 /` is the standard disk-full triage.
  - Mitigation: exempt commands carrying depth-cap flag ≤2. NOTE nuance: `du -d1` still walks full tree (report-depth only) — decide per-tool. [tests G5, ts G8]

- **G4.6 — pattern-vs-path positional args**
  - What: for `rg <pattern> /path`, `fd <pattern> /path`, `grep -r <pattern> /path`, first positional is PATTERN. find-style "all non-flag = root" extractor misfires.
  - Mitigation: per-program path extraction — rg/grep/egrep/rgrep skip first positional unless `-e`; fd skip first positional. [rego G6]

- **G4.7 — sudo/env/nice/nohup wrappers bypass `program_base`**
  - What: `sudo du -sh /` → `program_base` = `sudo`, not in set. Explore CA "key on program_base" does NOT fix sudo — program IS sudo.
  - Mitigation: parser-level wrapper unwrap (sudo/env/nice/nohup/time) before program extraction. [rego G8]

- **G4.8 — GROUP K ∩ GROUP L double-deny + unlock confusion**
  - What: `find /home/bhd` (depth 2) fires BOTH new rule AND `block-home-wide-find`. LD-G6 all-or-nothing → unlocking `block-shallow-heavy-scan` still denies via old rule.
  - Mitigation: precedence/ordering decision + overlap tests + message notes both keys. [rego G12, ts G5]

- **G4.9 — parity is string-only; no behavioral tests; item 10 names a nonexistent test file**
  - What: actual file is `catalog-parity.test.ts` (not `rule-catalog-parity.test.ts`). Parity asserts message strings only → cannot detect G5.1–G5.4 at all.
  - Mitigation: rename item to real file; add behavioral deny/allow fixture matrix + unlock e2e. [ts G4, ts G11, tests G6]

### Rank 3 (Moderate)

- **G3.1 — multi-root ANY vs ALL semantics undefined** — `find /var/lib/docker /var` (one allowed + one shallow): deny on ANY shallow root? Compound/pipeline tokens pollute args (GROUP J lesson). [rego G7, tests G8]
- **G3.2 — `find -newer/-fprint/-newerXY <value>` value tokens counted as roots** — `find . -newer /tmp/marker` → `/tmp/marker` (depth 1) false-deny. [rego G10]
- **G3.3 — fixed binary enumeration = stale set** — `ncdu`/`dust`/`tree`/`ag`/`bfs` absent now, installable later; no refresh seam. [rego G11]
- **G3.4 — command substitution / compound lines → raw fallback needed** — `du -sh $(echo /)`, `du / > out && du /var`. ShellQuoteParser bails to regex → args unusable. [rego G13]
- **G3.5 — family list incomplete + `inferFamilyFromProgram` has no du/rg/fd/ls cases** — wrong ruleId in audit/unlock. [ts G9]
- **G3.6 — single unlock key vs per-family rule ids inconsistency** — one message across ≥6 families vs one RuleMeta. [ts G10]
- **G3.7 — invocation forms** — `/usr/bin/find /` (argv[0] abs path), `exa` (predecessor) in/out of exemption. [tests G7]

### Rank 2 (Minor)

- **G2.1 — weak verdict-only assertions** — assert triggered rule id + computed depth, not just allow/deny. [tests G11]
- **G2.2 — threshold boundary hardcoded, not pinned as data** — single constant/fixture for the 2/3 boundary. [tests G12]
- **G2.3 — item 4 (du allow ≥3) → implement as TEST assertion, not a rego allow rule** (rego `default allow:=true` + `deny[]` has no explicit-allow channel). [rego G14]
- **G2.4 — hardcoded username `/home/bhd/.local` + eza dependency in message** — use neutral example; offer `find <dir> -maxdepth 2` fallback remedy. [ts G12]

## Cross-references
- G4.1 ↔ G4.4 (eza recursion flag). G5.1 ↔ G5.4 (path normalization + cwd). G4.8 ↔ G3.6 (overlap + unlock). G5.3 ↔ G4.5 (du depth vs flags).
