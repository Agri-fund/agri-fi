# network_policy_test.rego — OPA unit tests for network_policy.rego (#1039)
#
# Run with:  opa test devops/policy/k8s/ -v
#
# These tests exercise the deny/warn rules in isolation without requiring
# conftest or a live cluster. They cover both the positive path (compliant
# manifests produce no violations) and the negative path (non-compliant
# manifests produce the expected denial message).
package main_test

import future.keywords.if
import future.keywords.in

# ─── Fixtures ─────────────────────────────────────────────────────────────────

# Compliant default-deny egress policy (no rules, bare Egress type).
valid_default_deny := {
  "apiVersion": "networking.k8s.io/v1",
  "kind": "NetworkPolicy",
  "metadata": {
    "name": "backend-default-deny-egress",
    "namespace": "agri-fi",
    "labels": {
      "app.kubernetes.io/component": "backend",
      "policy-type": "egress-default-deny",
    },
    "annotations": {"agri-fi/issue": "#1039"},
  },
  "spec": {
    "podSelector": {"matchLabels": {"app.kubernetes.io/component": "backend"}},
    "policyTypes": ["Egress"],
  },
}

# Compliant egress allow-list — all required ports present, RFC-1918 excluded.
valid_allowlist := {
  "apiVersion": "networking.k8s.io/v1",
  "kind": "NetworkPolicy",
  "metadata": {
    "name": "backend-egress-allowlist",
    "namespace": "agri-fi",
    "labels": {
      "app.kubernetes.io/component": "backend",
      "policy-type": "egress-allowlist",
    },
    "annotations": {"agri-fi/issue": "#1039"},
  },
  "spec": {
    "podSelector": {"matchLabels": {"app.kubernetes.io/component": "backend"}},
    "policyTypes": ["Egress"],
    "egress": [
      # DNS
      {"ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]},
      # Postgres
      {
        "to": [{"podSelector": {"matchLabels": {"component": "postgres"}}}],
        "ports": [{"protocol": "TCP", "port": 5432}],
      },
      # RabbitMQ AMQP
      {
        "to": [{"podSelector": {"matchLabels": {"component": "rabbitmq"}}}],
        "ports": [{"protocol": "TCP", "port": 5672}],
      },
      # RabbitMQ Management
      {
        "to": [{"podSelector": {"matchLabels": {"component": "rabbitmq"}}}],
        "ports": [{"protocol": "TCP", "port": 15672}],
      },
      # Redis
      {
        "to": [{"podSelector": {"matchLabels": {"component": "redis"}}}],
        "ports": [{"protocol": "TCP", "port": 6379}],
      },
      # HTTPS (Horizon, Discord, AWS KMS, Slack)
      {
        "to": [{
          "ipBlock": {
            "cidr": "0.0.0.0/0",
            "except": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
          },
        }],
        "ports": [{"protocol": "TCP", "port": 443}],
      },
      # SMTP
      {
        "to": [{
          "ipBlock": {
            "cidr": "0.0.0.0/0",
            "except": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
          },
        }],
        "ports": [
          {"protocol": "TCP", "port": 587},
          {"protocol": "TCP", "port": 465},
        ],
      },
    ],
  },
}

# ─── Positive tests (compliant input → no violations) ─────────────────────────

test_valid_default_deny_produces_no_deny if {
  # Import the rules from the main package by evaluating with this input
  count(data.main.deny) == 0 with input as valid_default_deny
}

test_valid_allowlist_produces_no_deny if {
  count(data.main.deny) == 0 with input as valid_allowlist
}

test_valid_allowlist_produces_no_warn if {
  count(data.main.warn) == 0 with input as valid_allowlist
}

# ─── Negative tests — missing required ports ──────────────────────────────────

test_deny_when_dns_port_missing if {
  # Remove port 53 from the egress rules
  no_dns := json.patch(valid_allowlist, [{
    "op": "replace",
    "path": "/spec/egress/0/ports",
    "value": [],   # DNS rule has no ports → 53 disappears
  }])
  denials := data.main.deny with input as no_dns
  some d in denials
  contains(d, "53")
}

test_deny_when_postgres_port_missing if {
  # Remove the Postgres rule entirely
  no_pg := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/1"}])
  denials := data.main.deny with input as no_pg
  some d in denials
  contains(d, "5432")
}

test_deny_when_rabbitmq_amqp_missing if {
  no_rmq := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/2"}])
  denials := data.main.deny with input as no_rmq
  some d in denials
  contains(d, "5672")
}

test_deny_when_rabbitmq_management_missing if {
  no_mgmt := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/3"}])
  denials := data.main.deny with input as no_mgmt
  some d in denials
  contains(d, "15672")
}

test_deny_when_redis_port_missing if {
  no_redis := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/4"}])
  denials := data.main.deny with input as no_redis
  some d in denials
  contains(d, "6379")
}

test_deny_when_https_port_missing if {
  no_https := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/5"}])
  denials := data.main.deny with input as no_https
  some d in denials
  contains(d, "443")
}

test_deny_when_smtp_ports_missing if {
  no_smtp := json.patch(valid_allowlist, [{"op": "remove", "path": "/spec/egress/6"}])
  denials := data.main.deny with input as no_smtp
  # Both 587 and 465 must be flagged
  smtp587_denied := [d | some d in denials; contains(d, "587")]
  smtp465_denied := [d | some d in denials; contains(d, "465")]
  count(smtp587_denied) > 0
  count(smtp465_denied) > 0
}

# ─── Negative tests — forbidden ports ────────────────────────────────────────

test_deny_when_port_22_opened if {
  with_ssh := json.patch(valid_allowlist, [{
    "op": "add",
    "path": "/spec/egress/-",
    "value": {"ports": [{"protocol": "TCP", "port": 22}]},
  }])
  denials := data.main.deny with input as with_ssh
  some d in denials
  contains(d, "22")
}

test_deny_when_port_25_opened if {
  with_smtp_relay := json.patch(valid_allowlist, [{
    "op": "add",
    "path": "/spec/egress/-",
    "value": {"ports": [{"protocol": "TCP", "port": 25}]},
  }])
  denials := data.main.deny with input as with_smtp_relay
  some d in denials
  contains(d, "25")
}

# ─── Negative tests — ipBlock without RFC-1918 exclusions ────────────────────

test_deny_when_10_0_0_0_not_excluded if {
  # Remove the 10.0.0.0/8 exclusion from the HTTPS ipBlock rule
  missing_10 := json.patch(valid_allowlist, [{
    "op": "replace",
    "path": "/spec/egress/5/to/0/ipBlock/except",
    "value": ["172.16.0.0/12", "192.168.0.0/16"],  # 10.0.0.0/8 removed
  }])
  denials := data.main.deny with input as missing_10
  some d in denials
  contains(d, "10.0.0.0/8")
}

test_deny_when_172_16_not_excluded if {
  missing_172 := json.patch(valid_allowlist, [{
    "op": "replace",
    "path": "/spec/egress/5/to/0/ipBlock/except",
    "value": ["10.0.0.0/8", "192.168.0.0/16"],
  }])
  denials := data.main.deny with input as missing_172
  some d in denials
  contains(d, "172.16.0.0/12")
}

test_deny_when_192_168_not_excluded if {
  missing_192 := json.patch(valid_allowlist, [{
    "op": "replace",
    "path": "/spec/egress/5/to/0/ipBlock/except",
    "value": ["10.0.0.0/8", "172.16.0.0/12"],
  }])
  denials := data.main.deny with input as missing_192
  some d in denials
  contains(d, "192.168.0.0/16")
}

# ─── Negative tests — blanket allow-all egress rule ──────────────────────────

test_deny_when_blanket_egress_rule_present if {
  with_blanket := json.patch(valid_allowlist, [{
    "op": "add",
    "path": "/spec/egress/-",
    "value": {"to": [], "ports": []},  # empty to + empty ports = allow-all
  }])
  denials := data.main.deny with input as with_blanket
  some d in denials
  contains(d, "blanket egress rule")
}

# ─── Negative tests — missing annotation ─────────────────────────────────────

test_deny_when_issue_annotation_missing if {
  no_annotation := json.patch(valid_allowlist, [
    {"op": "remove", "path": "/metadata/annotations/agri-fi~1issue"},
  ])
  denials := data.main.deny with input as no_annotation
  some d in denials
  contains(d, "agri-fi/issue")
}

# ─── Negative tests — wrong namespace ────────────────────────────────────────

test_deny_when_namespace_is_default if {
  wrong_ns := json.patch(valid_allowlist, [{
    "op": "replace",
    "path": "/metadata/namespace",
    "value": "default",
  }])
  denials := data.main.deny with input as wrong_ns
  some d in denials
  contains(d, "namespace")
}

# ─── Negative tests — default-deny missing label ─────────────────────────────

test_deny_when_default_deny_missing_label if {
  no_label := json.patch(valid_default_deny, [{
    "op": "remove",
    "path": "/metadata/labels/policy-type",
  }])
  denials := data.main.deny with input as no_label
  some d in denials
  contains(d, "egress-default-deny")
}

# ─── Non-NetworkPolicy resources are ignored ─────────────────────────────────

test_non_networkpolicy_produces_no_deny if {
  deployment := {
    "apiVersion": "apps/v1",
    "kind": "Deployment",
    "metadata": {"name": "some-deploy", "namespace": "agri-fi"},
    "spec": {},
  }
  count(data.main.deny) == 0 with input as deployment
}

test_non_backend_networkpolicy_produces_no_deny if {
  redis_policy := {
    "apiVersion": "networking.k8s.io/v1",
    "kind": "NetworkPolicy",
    "metadata": {
      "name": "redis-policy",
      "namespace": "agri-fi",
      "labels": {"app.kubernetes.io/component": "redis"},
    },
    "spec": {
      "podSelector": {"matchLabels": {"app.kubernetes.io/component": "redis"}},
      "policyTypes": ["Egress"],
    },
  }
  count(data.main.deny) == 0 with input as redis_policy
}
