# Security Guidelines

## Secret Scanning

This repository implements automated secret scanning to prevent accidental credential commits.

### How It Works

1. **Pre-commit Hook (Local)** - Optional local validation on your machine
2. **GitHub Actions (Required)** - Automated server-side checks on all commits
3. **TruffleHog Scanner** - Detects API keys, tokens, passwords, and other credentials

### Setup for Developers

#### Option 1: Enable Pre-Commit Hook (Recommended)

Install TruffleHog locally to catch secrets before pushing:

```bash
# Install TruffleHog
pip install trufflehog

# Enable the pre-commit hook (make it executable)
chmod +x .git/hooks/pre-commit
```

Now, any commit with secrets will be blocked locally before reaching the server.

#### Option 2: Manual Pre-Commit Scan

If you prefer manual scanning:

```bash
# Scan current uncommitted changes
trufflehog filesystem .

# Scan specific file
trufflehog filesystem path/to/file
```

### If You Accidentally Commit Secrets

**Act immediately** — exposed credentials pose security risks.

#### Step 1: Identify the Compromised Secret

Check the failed workflow run to see which patterns matched.

#### Step 2: Rotate the Credential

- Change API keys, tokens, and passwords immediately
- Update services that use the exposed credential
- Monitor for unauthorized access

#### Step 3: Remove from Git History

Use `git filter-branch` or `git rebase` to remove the secret:

```bash
# Option A: Rebase to remove the commit (if not yet pushed to main)
git rebase -i HEAD~N  # N = number of commits to rebase

# Option B: Use git filter-branch for complex scenarios
git filter-branch --tree-filter 'rm -f path/to/secret-file' HEAD
```

#### Step 4: Force Push (Only for Unpushed Commits)

```bash
git push -f origin your-branch
```

### What Gets Scanned

TruffleHog detects patterns for:

- AWS credentials
- Private keys (RSA, DSA, EC, PGP)
- Database credentials
- API tokens and keys
- OAuth tokens
- Slack tokens
- GitHub tokens
- And many more...

### Common False Positives

If TruffleHog flags something that isn't actually a secret:

1. Use `truffleHog` directly to verify
2. Document the false positive in a comment
3. Contact the security team if you need an exception

### `.env` Files and Secrets Management

**Never commit `.env` files containing actual secrets.**

```bash
# ✅ Good: Use .env.example with placeholder values
DB_PASSWORD=your_password_here
API_KEY=your_api_key_here

# ✅ Good: Add to .gitignore
echo ".env" >> .gitignore

# ❌ Wrong: Never commit actual credentials
# .env files with real values should always be in .gitignore
```

### Resources

- [TruffleHog Documentation](https://github.com/trufflesecurity/trufflehog)
- [OWASP: Sensitive Data Exposure](https://owasp.org/www-project-top-ten/)
- [Git Credential Management](https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage)

### Questions or Issues?

If you encounter false positives or have questions, open an issue or contact the security team.

---

**Last Updated:** June 2026
