# CI Build Failure Notifications Setup

This guide explains how to set up Discord and/or Slack notifications for CI build failures.

## Overview

The following workflows now support automatic notifications on build failures:

- `ci.yml` - Main CI workflow (linting & testing)
- `backend-ci.yml` - Backend CI workflow
- `frontend-ci.yml` - Frontend CI workflow

Notifications are sent to Discord and/or Slack when any of these workflows fail, including:

- Repository and branch information
- Commit SHA and author
- Direct link to the failing workflow run

## Setup Instructions

### Discord Setup

#### 1. Create a Webhook in Discord

1. Go to your Discord server
2. Right-click on the channel where you want build failure notifications
3. Select **Edit Channel**
4. Go to **Integrations** → **Webhooks**
5. Click **New Webhook**
6. Name it (e.g., "GitHub Actions")
7. Copy the webhook URL
8. Click **Save**

#### 2. Add the Webhook to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `DISCORD_WEBHOOK_URL`
5. Value: Paste the Discord webhook URL
6. Click **Add secret**

### Slack Setup

#### 1. Create a Webhook in Slack

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name: e.g., "GitHub Actions"
4. Select your workspace
5. Go to **Incoming Webhooks** in the left sidebar
6. Toggle **Activate Incoming Webhooks** to ON
7. Click **Add New Webhook to Workspace**
8. Select the channel where you want notifications
9. Click **Allow**
10. Copy the webhook URL

#### 2. Add the Webhook to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `SLACK_WEBHOOK_URL`
5. Value: Paste the Slack webhook URL
6. Click **Add secret**

## How It Works

When a CI workflow fails:

1. The `if: failure()` condition in the "Notify on failure" step triggers
2. The script checks if webhook URLs are configured (as secrets)
3. For **Discord**: Sends a simple notification with links and details
4. For **Slack**: Sends a rich formatted message with block kit formatting

### Notification Contents

Each notification includes:

- ✅ Status indicator (❌ for failures)
- Repository name
- Branch name
- Commit SHA
- Author (actor) name
- Direct link to the workflow run logs

### Example Notifications

**Discord:**

```
❌ **Backend CI Build Failed**

Repository: agri-fi-1
Branch: main
Commit: abc123def456
Actor: jumokemariam04
Workflow: Backend CI
Run: https://github.com/agri-fi-1/actions/runs/12345
```

**Slack:**
Rich formatted message with:

- Header: "❌ Backend CI Build Failed"
- Sections with Repository, Branch, Commit, and Actor fields
- Action button: "View Workflow Run"

## Troubleshooting

### Notifications not appearing?

1. **Verify secrets are set**: Go to Settings → Secrets and check that `DISCORD_WEBHOOK_URL` and/or `SLACK_WEBHOOK_URL` are present
2. **Check webhook validity**: Test webhooks manually with curl:

   ```bash
   # Discord
   curl -X POST YOUR_DISCORD_WEBHOOK_URL \
     -H "Content-Type: application/json" \
     -d '{"content": "Test message"}'

   # Slack
   curl -X POST YOUR_SLACK_WEBHOOK_URL \
     -H "Content-Type: application/json" \
     -d '{"text": "Test message"}'
   ```

3. **Check workflow logs**: Go to Actions → workflow run → scroll to "Notify on failure" step for error details
4. **Permissions**: Ensure the webhook URL is correct and hasn't expired

### Only one channel receiving notifications?

- Configure both `DISCORD_WEBHOOK_URL` and `SLACK_WEBHOOK_URL` secrets
- Each workflow will automatically send to whichever is configured

## Customization

To customize notification messages, edit the JSON payload in the respective workflow file:

**Discord payload** (in `curl` command):

```json
{
  "content": "Your custom message",
  "username": "Custom Bot Name"
}
```

**Slack payload** (in `curl` command):

```json
{
  "text": "Your custom message",
  "blocks": [...]
}
```

For Slack blocks reference, see: [Slack Block Kit Documentation](https://api.slack.com/block-kit)

## Next Steps

- [ ] Set up Discord webhook and add `DISCORD_WEBHOOK_URL` secret
- [ ] Set up Slack webhook and add `SLACK_WEBHOOK_URL` secret
- [ ] Test by triggering a workflow failure (e.g., commit a linting error)
- [ ] Verify notifications appear in your channels

---

**Last Updated**: 2026-07-27
**Workflows Updated**: ci.yml, backend-ci.yml, frontend-ci.yml
