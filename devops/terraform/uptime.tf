terraform {
  required_version = ">= 1.5.0"

  required_providers {
    uptimerobot = {
      source  = "louy/uptimerobot"
      version = "~> 0.8"
    }
  }
}

provider "uptimerobot" {
  api_key = var.uptimerobot_api_key
}

variable "uptimerobot_api_key" {
  description = "UptimeRobot API key"
  type        = string
  sensitive   = true
  default     = "dummy-uptimerobot-key-for-plan"
}

variable "api_domain" {
  description = "Public domain name for the Agri-Fi API and services"
  type        = string
  default     = "api.agri-fi.com"
}

variable "status_page_domain" {
  description = "Custom CNAME domain for the public status page"
  type        = string
  default     = "status.agri-fi.com"
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for UptimeRobot alert routing"
  type        = string
  sensitive   = true
  default     = "https://hooks.slack.com/services/DUMMY/SLACK/WEBHOOK"
}

variable "alert_contacts" {
  description = "Alert contact definitions keyed by name"
  type = map(object({
    type  = string
    value = string
  }))
  default = {
    "slack-devops" = {
      type  = "webhook"
      value = "https://hooks.slack.com/services/DUMMY/SLACK/WEBHOOK"
    }
    "pagerduty-critical" = {
      type  = "email"
      value = "alerts@agri-fi.com"
    }
  }
}

variable "monitor_targets" {
  description = "HTTP monitor targets keyed by monitor name"
  type = map(object({
    url             = string
    interval        = optional(number, 60)
    timeout         = optional(number, 30)
    contact_names   = list(string)
  }))
  default = {
    "Public API Health (/v1/health)" = {
      url           = "https://api.agri-fi.com/v1/health"
      interval      = 60
      timeout       = 30
      contact_names = ["slack-devops", "pagerduty-critical"]
    }
    "Public API Documentation (Swagger / SDK)" = {
      url           = "https://api.agri-fi.com/api/docs"
      interval      = 120
      timeout       = 30
      contact_names = ["slack-devops"]
    }
    "Stellar SEP Discovery (.well-known/stellar.toml)" = {
      url           = "https://api.agri-fi.com/.well-known/stellar.toml"
      interval      = 180
      timeout       = 30
      contact_names = ["slack-devops"]
    }
    "SEP-24 Interactive Transfer Endpoint" = {
      url           = "https://api.agri-fi.com/v1/transfers/sep24/info"
      interval      = 120
      timeout       = 30
      contact_names = ["slack-devops", "pagerduty-critical"]
    }
  }
}

resource "uptimerobot_alert_contact" "contacts" {
  for_each = var.alert_contacts

  friendly_name = each.key
  type          = each.value.type
  value         = each.value.value
}

locals {
  monitor_contact_ids = {
    for name, monitor in var.monitor_targets :
    name => [
      for contact_name in monitor.contact_names :
      uptimerobot_alert_contact.contacts[contact_name].id
      if contains(keys(uptimerobot_alert_contact.contacts), contact_name)
    ]
  }
}

resource "uptimerobot_monitor" "http_targets" {
  for_each = var.monitor_targets

  friendly_name = each.key
  type          = "http"
  url           = each.value.url
  interval      = each.value.interval
  timeout       = each.value.timeout

  alert_contacts = local.monitor_contact_ids[each.key]
}

# ── Public Status Page ────────────────────────────────────────────────────────
# Aggregates public monitor endpoints into a customer-facing status page.
resource "uptimerobot_status_page" "public_status" {
  friendly_name = "Agri-Fi Public Status"
  custom_domain = var.status_page_domain
  sort          = "up-down-paused"
  monitors      = [for m in uptimerobot_monitor.http_targets : m.id]
}

