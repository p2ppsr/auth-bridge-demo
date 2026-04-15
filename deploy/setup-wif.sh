#!/bin/bash
# One-time setup for Workload Identity Federation between GitHub Actions and GCP.
#
# This creates:
#   - A service account for the deploy workflow
#   - A Workload Identity Pool + Provider configured for GitHub OIDC
#   - IAM bindings that allow the specified GitHub repo to impersonate the service account
#
# Usage:
#   GITHUB_REPO="owner/repo" ./setup-wif.sh
#
# The script prints the secret values you need to add to GitHub.

set -e

PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO=owner/repo}"

POOL_ID="github-actions-pool"
PROVIDER_ID="github-provider"
SERVICE_ACCOUNT_NAME="github-deploy"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setting up Workload Identity Federation"
echo "  Project: $PROJECT_ID ($PROJECT_NUMBER)"
echo "  GitHub Repo: $GITHUB_REPO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Enable required APIs
echo "▶ Enabling APIs..."
gcloud services enable \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com \
  --quiet

# Create service account
echo "▶ Creating service account..."
gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
  --display-name="GitHub Actions Deployer" \
  --quiet 2>/dev/null || echo "  (service account already exists)"

# Grant permissions to the service account
echo "▶ Granting roles to service account..."
for role in roles/run.admin roles/cloudsql.client roles/storage.admin roles/artifactregistry.admin roles/iam.serviceAccountUser roles/secretmanager.secretAccessor roles/cloudbuild.builds.editor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
  echo "  ✓ $role"
done

# Create Workload Identity Pool
echo "▶ Creating Workload Identity Pool..."
gcloud iam workload-identity-pools create "$POOL_ID" \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --quiet 2>/dev/null || echo "  (pool already exists)"

POOL_NAME=$(gcloud iam workload-identity-pools describe "$POOL_ID" \
  --location=global --format='value(name)')

# Create OIDC Provider
echo "▶ Creating OIDC provider..."
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --quiet 2>/dev/null || echo "  (provider already exists)"

PROVIDER_NAME="${POOL_NAME}/providers/${PROVIDER_ID}"

# Allow the GitHub repo to impersonate the service account
echo "▶ Binding GitHub repo to service account..."
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Workload Identity Federation ready"
echo
echo "Add these as GitHub repo secrets:"
echo
echo "  GCP_PROJECT_ID                    = $PROJECT_ID"
echo "  GCP_SERVICE_ACCOUNT               = $SERVICE_ACCOUNT_EMAIL"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER    = $PROVIDER_NAME"
echo
echo "(Or run ./deploy/push-github-secrets.sh which does this automatically)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
