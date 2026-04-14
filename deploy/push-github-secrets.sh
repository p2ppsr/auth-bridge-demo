#!/bin/bash
# Push required secrets to GitHub Actions using the gh CLI.
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - Running inside a git repo that is already linked to GitHub
#   - .env file populated (run 'npm run setup' in the parent dir)
#   - setup-wif.sh has been run (so we can get the WIF provider name)
#
# Usage: ./push-github-secrets.sh

set -e

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# GCP info
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SERVICE_ACCOUNT_EMAIL="github-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/providers/github-provider"

# Verify gh is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run 'gh auth login' first."
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
if [ -z "$REPO" ]; then
  echo "Error: not inside a repo linked to GitHub. Run 'gh repo create' first."
  exit 1
fi

echo "Setting secrets on $REPO..."

set_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "  ⚠ Skipping $name (empty)"
    return
  fi
  echo -n "$value" | gh secret set "$name" --repo "$REPO"
  echo "  ✓ $name"
}

# GCP / WIF auth
set_secret "GCP_PROJECT_ID"                 "$PROJECT_ID"
set_secret "GCP_SERVICE_ACCOUNT"            "$SERVICE_ACCOUNT_EMAIL"
set_secret "GCP_WORKLOAD_IDENTITY_PROVIDER" "$PROVIDER_NAME"

# Build-time frontend vars (baked into the SPA at build time)
set_secret "VITE_GOOGLE_CLIENT_ID"          "$VITE_GOOGLE_CLIENT_ID"

echo
echo "✓ GitHub secrets configured on $REPO"
echo
echo "Note: App runtime secrets (DB password, wallet keys, OAuth client secret)"
echo "      are stored in Google Secret Manager and loaded by Cloud Run directly."
echo "      Run ./deploy/setup-secrets.sh to sync those from .env."
