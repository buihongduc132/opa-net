package cupcake.system

import rego.v1

# ──────────────────────────────────────────────────────────────────
# Cupcake system aggregation entrypoint.
#
# Walks every policy under data.cupcake.policies.* and aggregates all
# `deny` decision verbs into a single evaluate result:
#
#   {
#     "decision": "deny" | "allow",
#     "deny":     [ { rule_id, reason, severity }, ... ],
#     "reasons":  <same array as deny>
#   }
#
# decision is "deny" iff count(deny) > 0, else "allow". `reasons` aliases
# `deny`. Output is sorted by (rule_id, reason) for deterministic ordering.
# ──────────────────────────────────────────────────────────────────

# Collect every deny object emitted by any loaded policy package.
all_deny := [d | d := data.cupcake.policies[_].deny[_]]

# Sort deny objects by (rule_id, reason) tuple for deterministic output.
sorted_deny := sorted if {
	keyed := [[d.rule_id, d.reason, d.severity] | some d in all_deny]
	sorted_keys := sort(keyed)
	sorted := [{"rule_id": x[0], "reason": x[1], "severity": x[2]} | some x in sorted_keys]
}

evaluate := {
	"decision": "deny",
	"deny": sorted_deny,
	"reasons": sorted_deny,
} if {
	count(sorted_deny) > 0
}

evaluate := {
	"decision": "allow",
	"deny": [],
	"reasons": [],
} if {
	count(all_deny) == 0
}
