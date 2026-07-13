#!/usr/bin/env bash
# Smoke test: verify the OPA engine evaluates both allow and deny paths.
# Exits 0 only when:
#   - "git status" -> exit 0, decision=allow
#   - "git stash pop" -> exit 2, decision=deny
set -uo pipefail

BIN="bin/pi-opa-net.js"

decision_of() {
  printf '%s' "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).decision)}catch(e){console.log('PARSE_ERROR')}})"
}

ALLOW_OUT=$(bun run "$BIN" eval "git status" --json 2>/dev/null) && ALLOW_RC=0 || ALLOW_RC=$?
ALLOW_DEC=$(decision_of "$ALLOW_OUT")

DENY_OUT=$(bun run "$BIN" eval "git stash pop" --json 2>/dev/null) && DENY_RC=0 || DENY_RC=$?
DENY_DEC=$(decision_of "$DENY_OUT")

ok=true
if [ "$ALLOW_RC" != "0" ] || [ "$ALLOW_DEC" != "allow" ]; then
  echo "smoke FAIL allow: rc=$ALLOW_RC decision=$ALLOW_DEC" >&2
  ok=false
fi
if [ "$DENY_RC" != "2" ] || [ "$DENY_DEC" != "deny" ]; then
  echo "smoke FAIL deny: rc=$DENY_RC decision=$DENY_DEC" >&2
  ok=false
fi

if $ok; then
  echo "smoke OK: allow(rc=0,decision=allow) + deny(rc=2,decision=deny)"
  exit 0
fi
exit 1
