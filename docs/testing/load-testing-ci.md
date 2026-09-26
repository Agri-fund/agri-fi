# CI Performance Gate & Load Testing Thresholds

Agri-Fi enforces automated performance budgets on every backend Pull Request via k6.

## Threshold Budgets

| Endpoint Flow | Metric | Budget Threshold | Action on Breach |
| --- | --- | --- | --- |
| **Marketplace Deals Feed** | `http_req_duration` | `p(95) < 500ms` | CI Fail / Block Merge |
| **Investment Allocation** | `http_req_duration` | `p(95) < 1000ms` | CI Fail / Block Merge |
| **Overall HTTP Error Rate** | `http_req_failed` | `< 1%` | CI Fail / Block Merge |

## Opt-Out Policy
Add the label `skip-perf-gate` or `infra-only` to the Pull Request if the change does not alter application runtime code.
