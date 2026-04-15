#!/bin/bash
# Deploy auth-bridge-example to Google Cloud Run
#
# Prerequisites:
#   1. gcloud authenticated and project selected
#   2. Cloud SQL instance created (see create-db.sh)
#   3. Secrets stored in Secret Manager (see setup-secrets.sh)
#
# Usage: ./deploy.sh

set -e

# ── Configuration ────────────────────────────────────────────────────
PROJECT_ID=$(gcloud config get-value project)
REGION="${REGION:-us-central1}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-auth-bridge-db}"
CLOUDSQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${CLOUDSQL_INSTANCE}"

BACKEND_SERVICE="auth-bridge-backend"
FRONTEND_SERVICE="auth-bridge-frontend"

# Build context is the auth-bridge-example repo root
BUILD_CONTEXT="$(cd "$(dirname "$0")/.." && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Deploying to Cloud Run"
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"
echo "  Cloud SQL: $CLOUDSQL_CONNECTION_NAME"
echo "  Build context: $BUILD_CONTEXT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# ── Build & deploy backend ───────────────────────────────────────────
echo "▶ Building backend image..."
BACKEND_IMAGE="gcr.io/${PROJECT_ID}/${BACKEND_SERVICE}:latest"

gcloud builds submit "$BUILD_CONTEXT" \
  --config="${BUILD_CONTEXT}/deploy/cloudbuild-backend.yaml" \
  --substitutions="_IMAGE=${BACKEND_IMAGE}"

echo "▶ Deploying backend to Cloud Run..."
gcloud run deploy "$BACKEND_SERVICE" \
  --image="$BACKEND_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances="$CLOUDSQL_CONNECTION_NAME" \
  --set-env-vars="DB_SOCKET_PATH=/cloudsql/${CLOUDSQL_CONNECTION_NAME},DB_NAME=auth_bridge,DB_USER=authbridge,BSV_CHAIN=main,STORAGE_URL=https://storage.babbage.systems,NODE_ENV=production" \
  --set-secrets="DB_PASSWORD=db-password:latest,SERVER_WALLET_KEY=server-wallet-key:latest,AUTH_BRIDGE_KEY=auth-bridge-key:latest,AUTH_BRIDGE_JWT_SECRET=jwt-secret:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest"

BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" --region="$REGION" --format="value(status.url)")
echo "✓ Backend: $BACKEND_URL"

# Update CORS to allow frontend (we'll set this after frontend deploys)
# ── Build & deploy frontend ──────────────────────────────────────────
echo
echo "▶ Building frontend image..."
FRONTEND_IMAGE="gcr.io/${PROJECT_ID}/${FRONTEND_SERVICE}:latest"

# Fetch VITE_GOOGLE_CLIENT_ID from Secret Manager for build-time injection
VITE_GOOGLE_CLIENT_ID=$(gcloud secrets versions access latest --secret=google-client-id 2>/dev/null || echo "")

gcloud builds submit "$BUILD_CONTEXT" \
  --config="${BUILD_CONTEXT}/deploy/cloudbuild-frontend.yaml" \
  --substitutions="_IMAGE=${FRONTEND_IMAGE},_VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}"

echo "▶ Deploying frontend to Cloud Run..."
gcloud run deploy "$FRONTEND_SERVICE" \
  --image="$FRONTEND_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="BACKEND_URL=${BACKEND_URL}"

FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE" --region="$REGION" --format="value(status.url)")

# Update backend FRONTEND_URL for CORS
echo
echo "▶ Updating backend CORS and auth base URL..."
gcloud run services update "$BACKEND_SERVICE" \
  --region="$REGION" \
  --update-env-vars="FRONTEND_URL=${FRONTEND_URL},AUTH_BASE_URL=${BACKEND_URL}/auth"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Deployed!"
echo "  Frontend: $FRONTEND_URL"
echo "  Backend:  $BACKEND_URL"
echo
echo "IMPORTANT: Add these to Google OAuth client authorized URIs:"
echo "  JavaScript origins: $FRONTEND_URL"
echo "  Redirect URIs:      $FRONTEND_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
