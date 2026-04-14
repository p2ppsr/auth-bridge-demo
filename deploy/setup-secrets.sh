#!/bin/bash
# Populate Secret Manager with the app's secrets from .env
# Usage: ./setup-secrets.sh

set -e

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Run 'npm run setup' first to generate it"
  exit 1
fi

# Source .env
set -a
source "$ENV_FILE"
set +a

create_or_update() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "⚠ Skipping $name (empty)"
    return
  fi
  if echo -n "$value" | gcloud secrets create "$name" --data-file=- 2>/dev/null; then
    echo "✓ Created secret: $name"
  else
    echo -n "$value" | gcloud secrets versions add "$name" --data-file=-
    echo "✓ Updated secret: $name"
  fi
}

echo "Storing secrets in Secret Manager..."
create_or_update "server-wallet-key" "$SERVER_WALLET_KEY"
create_or_update "auth-bridge-key" "$AUTH_BRIDGE_KEY"
create_or_update "jwt-secret" "$AUTH_BRIDGE_JWT_SECRET"
create_or_update "google-client-id" "$GOOGLE_CLIENT_ID"
create_or_update "google-client-secret" "$GOOGLE_CLIENT_SECRET"

# Grant Cloud Run service account access to the secrets
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in server-wallet-key auth-bridge-key jwt-secret google-client-id google-client-secret db-password; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null 2>&1 || true
done

echo
echo "✓ Secrets configured and accessible to Cloud Run service account"
