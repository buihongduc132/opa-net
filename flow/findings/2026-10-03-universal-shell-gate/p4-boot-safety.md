# Phase P4: Boot-Safety Proof & Unit Verification

## Overview
Phase P4 validates that the universal shell gate mechanisms do not compromise system boot, do not insert dependencies into the boot-critical path, and fail-open if the engine is dead or unavailable.

## Implemented Units
1. `opa-gate-populate.service`:
   - Oneshot service executing `/usr/bin/bash /opt/opa-gate/scripts/opa-gate-populate --shim-src /opt/opa-gate/scripts/.opa-gate-shim`
   - Configured with `Nice=19`, `CPUSchedulingPolicy=idle`, `DefaultDependencies=no`, `After=local-fs.target`
   - Absolute executable paths utilized exclusively; internal system PATH enforced in script to avoid self-gating recursion.
   - Atomic directory swap: staging directory populated first, followed by `/bin/mv` swap.
2. `opa-gate-populate.timer`:
   - Daily timer (`OnCalendar=daily`, `RandomizedDelaySec=1800`, `Persistent=true`)
   - Linked to `timers.target` (idle maintenance).

## Verification Results
1. **Unit Validation**:
   - `systemd-analyze verify /etc/systemd/system/opa-gate-populate.service /etc/systemd/system/opa-gate-populate.timer` exited with code 0 (clean, no warnings for gate units).
2. **Critical-Chain Invariant**:
   - `systemd-analyze critical-chain` compared pre- and post-installation.
   - Boot chain: `graphical.target -> multi-user.target -> komodo.service -> ... -> local-fs.target`.
   - Gate units do NOT appear in the critical chain.
3. **Target Wants**:
   - `sysinit.target.wants` and `basic.target.wants` contain zero gate references.
   - Only `timers.target.wants` contains `opa-gate-populate.timer`.
4. **Engine-Dead Simulation (F1 / Fail-Open Proof)**:
   - Temporarily renamed `/usr/local/bin/opa` to simulate a broken/missing policy engine.
   - Command executed through shim: `PATH="/opt/opa-gate/bin:$PATH" git status`.
   - Result: Fail-open execution succeeded immediately (`exit: 0`, real git status printed).
   - Confirmed: Boot-critical callers can never hang or brick the machine when engine fails.

## Acceptance Verdict
**PASSED**: Boot safety proven. Units verified clean, critical chain unchanged, fail-open behavior confirmed under engine failure.
