#!/bin/bash
# Push all required secrets to GitHub Actions using the gh CLI.
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - Running inside a git repo linked to GitHub
#   - .env file populated
#   - setup-wif.sh has been run
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

# GCP info for WIF
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
  echo "Error: not inside a repo linked to GitHub."
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

# Build-time frontend var
set_secret "VITE_GOOGLE_CLIENT_ID"          "$VITE_GOOGLE_CLIENT_ID"

# Database
set_secret "DB_HOST"                        "${DB_HOST_PROD:-}"
set_secret "DB_USER"                        "${DB_USER_PROD:-authbridge}"
set_secret "DB_PASSWORD"                    "${DB_PASSWORD_PROD:-}"
set_secret "DB_NAME"                        "${DB_NAME_PROD:-auth_bridge}"

# App secrets (runtime env vars)
set_secret "SERVER_WALLET_KEY"              "$SERVER_WALLET_KEY"
set_secret "AUTH_BRIDGE_KEY"                "$AUTH_BRIDGE_KEY"
set_secret "AUTH_BRIDGE_JWT_SECRET"         "$AUTH_BRIDGE_JWT_SECRET"
set_secret "GOOGLE_CLIENT_ID"               "$GOOGLE_CLIENT_ID"
set_secret "GOOGLE_CLIENT_SECRET"           "$GOOGLE_CLIENT_SECRET"

echo
echo "✓ GitHub secrets configured on $REPO"
