# Webhook Notification Setup

This document explains how to configure Slack and Discord webhook notifications for CI/CD build failures.

## Required Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

### Discord Webhook
- **Secret Name:** `DISCORD_WEBHOOK_URL`
- **Description:** Discord webhook URL for build failure notifications
- **How to create:**
  1. Go to your Discord server settings
  2. Navigate to Integrations → Webhooks
  3. Create a new webhook for the desired channel
  4. Copy the webhook URL (format: `https://discord.com/api/webhooks/...`)
  5. Add it as a repository secret

### Slack Webhook
- **Secret Name:** `SLACK_WEBHOOK_URL`
- **Description:** Slack webhook URL for build failure notifications
- **How to create:**
  1. Go to your Slack workspace
  2. Navigate to https://api.slack.com/apps
  3. Create a new app or use an existing one
  4. Enable Incoming Webhooks
  5. Add a new webhook to your desired channel
  6. Copy the webhook URL (format: `https://hooks.slack.com/services/...`)
  7. Add it as a repository secret

## Notification Behavior

### CI Workflow (`.github/workflows/ci.yml`)
- Triggers on: Pull requests to `main` and `develop` branches
- Notifies on: Failure of the lint-and-test job
- Includes: Repository, branch, commit SHA, actor, workflow name, and run link

### CD Workflow (`.github/workflows/cd.yml`)
- Triggers on: Push to `main` branch and manual workflow dispatch
- Notifies on: Failure of any job (prepare, build, or deploy)
- Includes: Repository, branch, commit SHA, actor, workflow name, job name, and run link
- Additional context for build job: Component (backend/frontend)
- Additional context for deploy job: Environment (staging)

## Testing

To test the webhook configuration:
1. Add the webhook URLs as repository secrets
2. Trigger a workflow that will fail (e.g., introduce a linting error)
3. Verify that notifications appear in your Discord/Slack channels

## Optional: Environment-Specific Secrets

If you want different webhooks for different environments (e.g., staging vs production), you can:
1. Create environment-specific secrets in GitHub (Settings → Environments)
2. Modify the workflow to use `${{ secrets.DISCORD_WEBHOOK_URL }}` for repository-level secrets
3. Or use `${{ vars.DISCORD_WEBHOOK_URL }}` for environment-level variables

## Security Notes

- Webhook URLs contain sensitive information and should never be committed to the repository
- Use repository secrets or environment secrets to store webhook URLs
- Regularly rotate webhook URLs for enhanced security
- Limit webhook permissions to only the necessary channels
