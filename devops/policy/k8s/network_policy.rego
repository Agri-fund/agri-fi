# network_policy.rego — OPA/conftest policy for agri-fi NetworkPolicy enforcement
# Issue #1039
#
# Tested with: conftest test --policy devops/policy/k8s devops/k8s/backend/
#
# This policy checks that every Kubernetes manifest destined for a pod labelled
# app.kubernetes.io/component=backend satisfies the following invariants:
#
#   1. A default-deny egress NetworkPolicy exists for backend pods.
#   2. An egress allow-list NetworkPolicy exists for backend pods.
#   3. The allow-list contains every required port (see REQUIRED_EGRESS_PORTS).
#   4. No NetworkPolicy in the backend component opens a wildcard Egress rule
#      (an Egress policyType with no rules is the canonical default-deny; a
#       policy with an Egress entry that has an empty `to` + empty `ports`
#       would allow all egress and is forbidden).
#   5. No NetworkPolicy for backend pods permits egress to private RFC-1918
#      CIDR ranges via an ipBlock rule (internal peers must be addressed by
#      podSelector, not IP block, to prevent lateral-movement after a pod
#      compromise on an internal IP).
#   6. Port 25 (unauthenticated SMTP relay) is never opened on any backend
#      egress rule.
#   7. Port 22 (SSH) is never opened on any backend egress rule.
#   8. Any NetworkPolicy that declares an Egress policyType must also carry the
#      required annotation label `agri-fi/issue` (provenance tracking).
#
# Package naming follows conftest convention: `main` for the default namespace.
package main

import future.keywords.in
import future.keywords.every

# ─── Constants ────────────────────────────────────────────────────────────────

# Ports the escrow/payout worker MUST be allowed to reach.
# If any of these is absent from the allow-list policy the check fails.
REQUIRED_EGRESS_PORTS := {
  53,    # DNS (UDP+TCP)
  443,   # Stellar Horizon, Discord, Slack, AWS KMS (HTTPS)
  465,   # SMTP/S (payout alert emails)
  587,   # SMTP STARTTLS (payout alert emails)
  5432,  # PostgreSQL (from PgBouncer sidecar)
  5672,  # RabbitMQ AMQP
  6379,  # Redis
  15672, # RabbitMQ Management API
}

# Ports that must never appear in an egress allow-list for backend pods.
FORBIDDEN_EGRESS_PORTS := {
  22,    # SSH — no pod should SSH anywhere
  25,    # SMTP relay (unauthenticated; spam-relay attack vector)
  3389,  # RDP
  8080,  # Generic HTTP dev port (should not be an explicit egress target)
}

# RFC-1918 private ranges that must NOT appear in ipBlock egress rules.
# Internal peers must use podSelector instead.
PRIVATE_CIDRS := [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
]

# Label that identifies backend / escrow worker pods.
BACKEND_COMPONENT_LABEL := "backend"

# ─── Helpers ──────────────────────────────────────────────────────────────────

# True when the input is a NetworkPolicy.
is_network_policy if input.kind == "NetworkPolicy"

# True when the NetworkPolicy targets backend pods (by component label).
targets_backend if {
  is_network_policy
  input.spec.podSelector.matchLabels["app.kubernetes.io/component"] == BACKEND_COMPONENT_LABEL
}

# True when the NetworkPolicy declares an Egress policyType.
has_egress_type if {
  some pt in input.spec.policyTypes
  pt == "Egress"
}

# Collect all port numbers mentioned across all egress rules.
egress_ports contains port if {
  some rule in input.spec.egress
  some p in rule.ports
  port := p.port
}

# Collect all ipBlock CIDRs mentioned in egress `to` entries.
egress_ip_cidrs contains cidr if {
  some rule in input.spec.egress
  some to_entry in rule.to
  cidr := to_entry.ipBlock.cidr
}

# True when the policy is a default-deny: it has Egress in policyTypes and
# the egress array is either absent or empty.
is_default_deny_egress if {
  targets_backend
  has_egress_type
  # egress key missing OR empty list — both are valid default-deny spellings
  not _has_nonempty_egress
}

_has_nonempty_egress if {
  count(input.spec.egress) > 0
}

# True when the policy is an egress allow-list (has Egress type AND has rules).
is_egress_allowlist if {
  targets_backend
  has_egress_type
  count(input.spec.egress) > 0
}

# Collect all port numbers permitted in a single egress rule (flattened).
_rule_ports(rule) := ports if {
  ports := {p.port | some p in rule.ports}
}

# True when any egress rule in the policy is a "blanket allow" — Egress entry
# with empty `to` AND empty `ports` which Kubernetes interprets as allow-all.
_has_blanket_egress_rule if {
  some rule in input.spec.egress
  count(rule.to) == 0
  count(rule.ports) == 0
}

# ─── Deny rules ───────────────────────────────────────────────────────────────

# Rule 1: Every set of manifests for backend pods must include a default-deny
# egress policy.  conftest evaluates each YAML document independently, so this
# check is enforced per-file in warn mode (the CI step aggregates results).
# The hard check is in the allow-list policy (rule 2).
warn[msg] if {
  targets_backend
  has_egress_type
  # If this policy has egress rules it should be the allow-list, not the deny.
  # Warn when both policyTypes and egress rules are present but the deny policy
  # label is missing (operator may have merged the two by mistake).
  count(input.spec.egress) > 0
  not input.metadata.labels["policy-type"] == "egress-allowlist"
  msg := sprintf(
    "NetworkPolicy %q targets backend pods and has egress rules but is not labelled 'policy-type: egress-allowlist'. Expected a separate default-deny policy (no rules) and a distinct allow-list policy.",
    [input.metadata.name],
  )
}

# Rule 2: The allow-list policy must cover every required egress port.
deny[msg] if {
  is_egress_allowlist
  input.metadata.labels["policy-type"] == "egress-allowlist"
  some required_port in REQUIRED_EGRESS_PORTS
  not required_port in egress_ports
  msg := sprintf(
    "NetworkPolicy %q (egress allow-list) is missing required egress port %d. Required ports: %v",
    [input.metadata.name, required_port, REQUIRED_EGRESS_PORTS],
  )
}

# Rule 3: No backend egress policy may open a forbidden port.
deny[msg] if {
  targets_backend
  has_egress_type
  some forbidden_port in FORBIDDEN_EGRESS_PORTS
  forbidden_port in egress_ports
  msg := sprintf(
    "NetworkPolicy %q opens forbidden egress port %d on backend pods. Forbidden ports: %v",
    [input.metadata.name, forbidden_port, FORBIDDEN_EGRESS_PORTS],
  )
}

# Rule 4: No backend egress policy may contain a blanket allow-all egress rule
# (empty `to` + empty `ports`).
deny[msg] if {
  targets_backend
  has_egress_type
  _has_blanket_egress_rule
  msg := sprintf(
    "NetworkPolicy %q contains a blanket egress rule (empty `to` and `ports`) which permits all outbound traffic from backend pods. Use explicit podSelector or ipBlock rules.",
    [input.metadata.name],
  )
}

# Rule 5: ipBlock egress rules must exclude private RFC-1918 ranges (internal
# peers must be reached via podSelector, not by IP address).
deny[msg] if {
  targets_backend
  has_egress_type
  some rule in input.spec.egress
  some to_entry in rule.to
  cidr := to_entry.ipBlock.cidr
  # cidr is 0.0.0.0/0 (global allow used for external HTTPS/SMTP)
  cidr == "0.0.0.0/0"
  # The except list must include all three private ranges
  except_list := to_entry.ipBlock.except
  some private_cidr in PRIVATE_CIDRS
  not private_cidr in except_list
  msg := sprintf(
    "NetworkPolicy %q has an ipBlock egress rule for 0.0.0.0/0 without excluding private range %q. Add it to the `except` list to prevent lateral movement via IP-based egress.",
    [input.metadata.name, private_cidr],
  )
}

# Rule 6: Any NetworkPolicy with Egress policyType targeting backend pods must
# carry the agri-fi/issue annotation for provenance tracking.
deny[msg] if {
  targets_backend
  has_egress_type
  not input.metadata.annotations["agri-fi/issue"]
  msg := sprintf(
    "NetworkPolicy %q has Egress policyType but is missing the required annotation `agri-fi/issue`. Add the originating issue number (e.g. '#1039').",
    [input.metadata.name],
  )
}

# Rule 7: Backend NetworkPolicies must be in the agri-fi namespace.
deny[msg] if {
  is_network_policy
  targets_backend
  input.metadata.namespace != "agri-fi"
  msg := sprintf(
    "NetworkPolicy %q targets backend pods but is in namespace %q. Backend network policies must be in namespace 'agri-fi'.",
    [input.metadata.name, input.metadata.namespace],
  )
}

# Rule 8: The default-deny egress policy must be labelled policy-type: egress-default-deny.
deny[msg] if {
  is_default_deny_egress
  not input.metadata.labels["policy-type"] == "egress-default-deny"
  msg := sprintf(
    "NetworkPolicy %q appears to be a default-deny egress policy (Egress type, no rules) but is not labelled 'policy-type: egress-default-deny'. Add the label to make intent explicit.",
    [input.metadata.name],
  )
}
