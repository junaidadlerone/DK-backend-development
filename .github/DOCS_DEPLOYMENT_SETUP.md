# Documentation Deployment Setup Guide

This guide explains how to set up automatic documentation deployment from the `door-knocker-backend` repository to the `door-knocker-api-docs` repository.

## Overview

The GitHub Actions workflow in `.github/workflows/deployment.yml` automatically syncs the `docs/` folder to the public documentation repository whenever changes are pushed to the `development` branch.

## Setup Steps

### 1. Create a Personal Access Token (PAT)

You need to create a GitHub Personal Access Token with permissions to push to the target repository.

#### Option A: Fine-Grained Personal Access Token (Recommended)

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Configure the token:
   - **Name**: `docs-deployment-token`
   - **Expiration**: Choose your preferred expiration (e.g., 90 days or 1 year)
   - **Repository access**: Select "Only select repositories"
     - Choose: `door-knocker-api-docs`
   - **Permissions**:
     - Repository permissions:
       - **Contents**: Read and write
       - **Metadata**: Read-only (automatically selected)
4. Click "Generate token"
5. **Copy the token immediately** (you won't be able to see it again)

#### Option B: Classic Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token" → "Generate new token (classic)"
3. Configure the token:
   - **Note**: `docs-deployment-token`
   - **Expiration**: Choose your preferred expiration
   - **Scopes**: Select only:
     - ✅ `repo` (Full control of private repositories)
4. Click "Generate token"
5. **Copy the token immediately**

### 2. Add Token to Repository Secrets

1. Go to your **private repository** (`door-knocker-backend`)
2. Navigate to: Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add the secret:
   - **Name**: `DOCS_DEPLOY_TOKEN`
   - **Value**: Paste the token you copied in step 1
5. Click "Add secret"

### 3. Verify Target Repository

Ensure the target repository exists and is properly configured:

1. Repository: `https://github.com/junaiiiid/door-knocker-api-docs`
2. Default branch: `main` (the workflow pushes to `main`)
3. GitHub Pages enabled:
   - Go to: Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / `/ (root)`
   - Click "Save"

### 4. Test the Workflow

#### Automated Test (Recommended)

1. Make a small change to any file in the `docs/` folder:
   ```bash
   cd /Users/junaidtariq/VSCodeProjects/door-knocker-backend
   echo "<!-- Updated -->" >> docs/README.md
   git add docs/README.md
   git commit -m "Test docs deployment"
   git push origin development
   ```

2. Check the workflow:
   - Go to: Actions tab in your private repo
   - You should see "Deploy Docs to External Repository" running
   - Wait for it to complete (usually 30-60 seconds)

3. Verify deployment:
   - Check: `https://github.com/junaiiiid/door-knocker-api-docs`
   - You should see your docs files
   - Check: `https://junaiiiid.github.io/door-knocker-api-docs/`
   - You should see the Swagger UI

#### Manual Test

You can also manually trigger the workflow:
1. Go to: Actions tab → Deploy Docs to External Repository
2. Click "Run workflow"
3. Select branch: `development`
4. Click "Run workflow"

## Workflow Features

### 🎯 Triggers

- **Push to development**: Automatically deploys when you push to `development` branch
- **Path filtering**: Only triggers when files in `docs/**` are changed
- **PR protection**: Does NOT deploy on pull requests (only on push)

### ✨ Key Features

1. **Idempotency**: Safe to run multiple times; skips if no changes
2. **Clean sync**: Removes old files from target repo before copying new ones
3. **Detailed commits**: Includes source commit SHA, author, and workflow info
4. **Status reporting**: Clear success/failure messages in workflow logs

### 📋 What Gets Deployed

The workflow copies **everything** from the `docs/` folder:
- `index.html` (redirect page)
- `swagger.html` (Swagger UI)
- `openapi.yaml` (OpenAPI specification)
- `README.md` (documentation guide)

### 🔒 Security

- Uses GitHub's built-in authentication
- Token is stored securely in GitHub Secrets
- Token is never exposed in logs
- Git user is `github-actions[bot]` (official GitHub Actions bot)

## Troubleshooting

### Error: "Resource not accessible by integration"

**Cause**: The token doesn't have the required permissions.

**Solution**:
1. Regenerate the token with the correct permissions (see step 1 above)
2. Update the `DOCS_DEPLOY_TOKEN` secret in your repository

### Error: "Authentication failed"

**Cause**: The token is invalid or expired.

**Solution**:
1. Check if the token has expired
2. Generate a new token and update the secret

### Error: "remote: Permission to junaiiiid/door-knocker-api-docs.git denied"

**Cause**: The token doesn't have access to the target repository.

**Solution**:
- If using fine-grained token: Ensure `door-knocker-api-docs` is selected in repository access
- If using classic token: Ensure the `repo` scope is enabled

### Workflow doesn't trigger

**Possible causes**:
1. No files changed in `docs/**` folder
2. Pushed to wrong branch (must be `development`)
3. Workflow file has syntax errors

**Solution**:
```bash
# Check workflow file syntax
cat .github/workflows/deployment.yml

# Ensure you're on development branch
git branch

# Make a change in docs/ folder
echo "test" >> docs/README.md
git add docs/README.md
git commit -m "Test deployment"
git push origin development
```

### "No changes to commit" every time

**Cause**: The docs/ folder hasn't changed since last deployment.

**Solution**: This is expected behavior (idempotency). Only deploy when docs actually change.

## Workflow Behavior

### When It Runs
✅ Push to `development` with changes in `docs/**`
❌ Push to other branches
❌ Pull requests (even to `development`)
❌ Changes outside `docs/**` folder

### What It Does
1. Checks out the source repository
2. Clones the target repository
3. Removes all files from target (except `.git`)
4. Copies all files from `docs/` to target
5. Commits with detailed message
6. Pushes to `main` branch of target repository
7. GitHub Pages automatically rebuilds (if enabled)

## Advanced Configuration

### Change Target Branch

If your target repository uses a different default branch (e.g., `gh-pages`):

Edit `.github/workflows/deployment.yml`:
```yaml
# Line 49
git push origin gh-pages  # Change 'main' to your branch name
```

### Deploy on Multiple Branches

To deploy from both `main` and `development`:

Edit `.github/workflows/deployment.yml`:
```yaml
on:
  push:
    branches:
      - development
      - main  # Add this line
    paths:
      - 'docs/**'
```

### Add Deployment Notifications

Add a Slack or Discord notification step:

```yaml
- name: Notify deployment
  if: success()
  run: |
    curl -X POST -H 'Content-type: application/json' \
      --data '{"text":"📚 Docs deployed successfully!"}' \
      ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Exclude Specific Files

To exclude certain files from deployment:

Edit the "Sync docs folder" step:
```yaml
- name: Sync docs folder to target repository
  run: |
    find target-repo -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

    # Copy all files except specific ones
    rsync -av --exclude='*.md' --exclude='*.yaml' docs/ target-repo/
```

## Maintenance

### Token Expiration

If you set an expiration on your token:

1. **Before expiration**: Create a new token following step 1
2. Update the `DOCS_DEPLOY_TOKEN` secret in your repository
3. Test the workflow to ensure it works

### Monitoring

Check deployment status:
1. Go to: Actions tab in your repository
2. Look for "Deploy Docs to External Repository" workflows
3. Green checkmark = successful deployment
4. Red X = failed deployment

### Logs

View detailed logs:
1. Click on any workflow run
2. Click on "deploy-docs" job
3. Expand any step to see detailed output

## Best Practices

1. **Always test locally first**: Preview your docs by opening `docs/index.html` in a browser
2. **Use meaningful commit messages**: This helps track what changed in deployments
3. **Monitor the Actions tab**: Keep an eye on deployment status
4. **Set token expiration**: Use 90-day or 1-year expiration for better security
5. **Document changes**: Update the changelog when making significant doc changes

## Support

If you encounter issues:
1. Check the workflow logs in the Actions tab
2. Verify all secrets are correctly set
3. Ensure the target repository exists and is accessible
4. Check GitHub's status page: https://www.githubstatus.com/

## Related Files

- Workflow: `.github/workflows/deployment.yml`
- Docs folder: `docs/`
- Target repository: https://github.com/junaiiiid/door-knocker-api-docs
- Live docs: https://junaiiiid.github.io/door-knocker-api-docs/
