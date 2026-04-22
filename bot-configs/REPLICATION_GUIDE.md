# PR Automation Replication Guide

This guide documents the two-bot GitHub Actions system used in Agri-Fi, how they interact, and how to replicate or extend the setup in a fork.

---

## 1. Architecture Overview

Agri-Fi uses two coordinated workflows for automated PR management.

### PR Review Bot (`.github/workflows/pr-review-bot.yml`)

Triggers on every PR opened, synchronized, or reopened against `main` or `develop`.

- Detects whether the changes touch `frontend/`, `backend/`, or both
- Runs the appropriate checks in parallel (lint, type-check, build, tests)
- Posts a structured review comment summarising each check result
- Applies area labels (`frontend`, `backend`) and a status label (`ready-for-review` or `needs-work`)
- Replaces its own previous comment on re-runs so the thread stays clean

Permissions required: `contents: read`, `pull-requests: write`, `issues: write`

### Auto-Merge Bot (`.github/workflows/auto-merge.yml`)

Triggers on PR review submission (`pull_request_review`) or check suite completion (`check_suite`).

Merges a PR automatically (squash) when **all** of the following are true:

- At least 1 approval, with no requested changes
- All check runs completed and passing
- PR is not a draft
- PR carries the `ready-for-review` label
- PR does not carry the `no-auto-merge` label

After a successful merge it deletes the head branch, unless it is `main` or `develop`.

Permissions required: `contents: write`, `pull-requests: write`

### How they interact

```
PR opened / pushed
       │
       ▼
PR Review Bot runs checks
       │
       ├─ checks pass  → applies ready-for-review label
       └─ checks fail  → applies needs-work label
                               │
                               ▼ (label + review event)
                        Auto-Merge Bot evaluates conditions
                               │
                               ├─ all conditions met → squash merge + delete branch
                               └─ condition missing  → no action, logs reason
```

No personal access tokens or external secrets are involved. Both bots operate exclusively with the built-in `GITHUB_TOKEN`.

---

## 2. Replicating the Setup in a Fork

### Step 1 — Fork the repository

Click **Fork** on GitHub. Clone your fork locally.

### Step 2 — Enable GitHub Actions

In your fork: **Settings → Actions → General → Allow all actions and reusable workflows**, then save.

### Step 3 — Verify GITHUB_TOKEN permissions

In your fork: **Settings → Actions → General → Workflow permissions**, select **Read and write permissions** and check **Allow GitHub Actions to create and approve pull requests**.

This grants the `GITHUB_TOKEN` the scopes the bots need:

| Scope | Required by |
|---|---|
| `contents: write` | Auto-Merge Bot (merge + branch delete) |
| `pull-requests: write` | Both bots |
| `issues: write` | PR Review Bot (labels + comments) |

No additional secrets are required.

### Step 4 — Create the required labels

The bots apply labels that must already exist in the repository. Run these commands once, replacing `OWNER/REPO`:

```bash
gh label create frontend        --color 0075ca --repo OWNER/REPO
gh label create backend         --color e4e669 --repo OWNER/REPO
gh label create ready-for-review --color 0e8a16 --repo OWNER/REPO
gh label create needs-work      --color d93f0b --repo OWNER/REPO
gh label create auto-merge      --color 1d76db --repo OWNER/REPO
gh label create no-auto-merge   --color b60205 --repo OWNER/REPO
```

### Step 5 — Verify

Push a branch and open a PR against `main` or `develop`. Within a few minutes you should see:

- The PR Review Bot comment appear on the PR
- Area labels (`frontend` and/or `backend`) applied
- A status label (`ready-for-review` or `needs-work`) applied

---

## 3. Required Labels

| Label | Created by | Purpose |
|---|---|---|
| `frontend` | PR Review Bot | Marks PR as touching frontend code |
| `backend` | PR Review Bot | Marks PR as touching backend code |
| `ready-for-review` | PR Review Bot | All automated checks passed |
| `needs-work` | PR Review Bot | One or more checks failed |
| `auto-merge` | Auto-Merge Bot | PR is being auto-merged |
| `no-auto-merge` | Maintainer | Prevents auto-merge |

Labels must exist before the bots run. See the `gh label create` commands in section 2.

---

## 4. Customising the Review Bot

### Changing which branches trigger the bot

```yaml
# .github/workflows/pr-review-bot.yml
on:
  pull_request:
    branches: [main, develop, staging]  # add branches here
```

### Requiring stricter test coverage

```yaml
- name: Backend - Run tests with coverage
  run: npm run test:cov -- --coverageThreshold=80
  working-directory: backend
```

### Adding a custom check

```yaml
- name: Custom check
  id: custom-check
  continue-on-error: true
  run: npm run your-script
```

Then reference `steps.custom-check.outcome` in the `post-review` job when building the comment body and determining the status label.

---

## 5. Customising Auto-Merge

### Requiring 2 approvals instead of 1

In `.github/workflows/auto-merge.yml`, find:

```js
if (approvals.length < 1) {
```

Change to:

```js
if (approvals.length < 2) {
```

### Preventing auto-merge on a specific PR

Add the `no-auto-merge` label to the PR. The bot checks for this label before proceeding. Removing the `ready-for-review` label also prevents merge.

### Changing merge strategy

In the merge call, update `merge_method`:

```js
await github.rest.pulls.merge({
  ...
  merge_method: 'merge',   // 'merge', 'squash', or 'rebase'
});
```

---

## 6. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Bot not commenting on PRs | Actions permissions not enabled | Settings → Actions → Allow all actions |
| Labels not being applied | Labels don't exist in repo | Run the `gh label create` commands in section 2 |
| Auto-merge not triggering | `ready-for-review` label missing | Ensure review bot ran and all checks passed |
| Auto-merge fails with 405 | Branch protection requires more approvals | Adjust protection rules or approval count |
| Bot re-reviews on every push | Expected behaviour on `synchronize` event | No action needed |

---

## 7. Security Considerations

- Both bots use only `GITHUB_TOKEN` — no personal access tokens or external secrets are needed.
- The review bot has `contents: read` only; it cannot push code.
- The auto-merge bot has `contents: write` scoped to merging and branch deletion only.
- Neither bot can access repository secrets.
- All bot actions are logged in the GitHub Actions tab and are fully auditable.

---

## 8. Emergency Manual Merge

If auto-merge fails or is blocked, a maintainer can merge directly:

```bash
gh pr merge <PR_NUMBER> --squash --repo OWNER/agri-fi
```

To also delete the branch after merging:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch --repo OWNER/agri-fi
```
