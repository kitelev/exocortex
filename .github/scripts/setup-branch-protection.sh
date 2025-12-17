#!/bin/bash

set -e

REPO="kitelev/exocortex"
BRANCH="main"

echo "🔒 Setting up Branch Protection Rules for $REPO:$BRANCH"
echo ""

if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub CLI"
    echo "Run: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI is authenticated"
echo ""

echo "Configuring branch protection for '$BRANCH' branch..."
echo ""

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/$REPO/branches/$BRANCH/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-and-test", "e2e-tests"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "required_linear_history": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

echo ""
echo "✅ Branch protection configured successfully!"
echo ""
echo "Protection rules applied:"
echo "  ✅ Require pull request before merging"
echo "  ✅ Require status checks to pass: build-and-test, e2e-tests"
echo "  ✅ Require branches to be up to date before merging"
echo "  ✅ Require linear history (no merge commits)"
echo "  ✅ Enforce restrictions for administrators"
echo "  ✅ Dismiss stale pull request approvals when new commits are pushed"
echo "  ✅ No direct pushes to main (must use PR)"
echo ""
echo "🎉 Branch protection is now active!"
echo ""
echo "To verify, visit:"
echo "https://github.com/$REPO/settings/branches"
