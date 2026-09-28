# Uptime Monitoring & Public Status Page

## 1. Architecture Overview
External availability monitoring is managed declaratively through Terraform (`devops/terraform/uptime.tf`) using the UptimeRobot provider.

This setup ensures:
1. **External Synthetic Probes**: Probes are fired from global edge nodes outside our AWS VPC, guaranteeing real user perspective.
2. **Public Status Page**: Customer and partner facing dashboard displaying real-time uptime status and historical SLA metrics.
3. **Multi-Channel Alert Routing**: Failures trigger instant Slack alerts into `#devops-alerts` and escalate critical outages to PagerDuty.

---

## 2. Monitored Endpoints

| Target Name | URL Path | Check Interval | Timeout | Target SLA |
|-------------|----------|----------------|---------|------------|
| **Public API Health** | `https://api.agri-fi.com/v1/health` | 60s | 30s | 99.95% |
| **Public API Documentation** | `https://api.agri-fi.com/api/docs` | 120s | 30s | 99.9% |
| **Stellar TOML Discovery** | `https://api.agri-fi.com/.well-known/stellar.toml` | 180s | 30s | 99.99% |
| **SEP-24 Interactive Transfer** | `https://api.agri-fi.com/v1/transfers/sep24/info` | 120s | 30s | 99.95% |

---

## 3. Terraform Deployment

To deploy or update monitors:
```bash
cd devops/terraform
terraform init
terraform apply -target=uptimerobot_monitor.http_targets -target=uptimerobot_status_page.public_status
```

### Environment Variables
- `TF_VAR_uptimerobot_api_key`: API key from UptimeRobot account.
- `TF_VAR_api_domain`: Base domain (defaults to `api.agri-fi.com`).
- `TF_VAR_status_page_domain`: Status page domain (e.g. `status.agri-fi.com`).
- `TF_VAR_slack_webhook_url`: Incoming webhook for Slack alert channel.
