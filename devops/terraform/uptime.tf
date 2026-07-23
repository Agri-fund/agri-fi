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
}

variable "alert_contacts" {
  description = "Alert contact definitions keyed by name"
  type = map(object({
    type  = string
    value = string
  }))
}

variable "monitor_targets" {
  description = "HTTP monitor targets keyed by monitor name"
  type = map(object({
    url             = string
    interval        = optional(number, 60)
    timeout         = optional(number, 30)
    contact_names   = list(string)
  }))
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
