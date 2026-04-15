# Deploying to Google Cloud Run

This directory contains scripts to deploy the auth-bridge-example to Google Cloud Run.

## Architecture

- **Backend** (Cloud Run) — Express server running auth-bridge-express
- **Frontend** (Cloud Run + nginx) — Static Vite build, proxies API calls to backend
- **Database** (Cloud SQL MySQL) — Managed MySQL 8.0 instance
- **Secrets** (Secret Manager) — OAuth credentials, JWT secret, wallet keys

## Prerequisites

```bash
# 1. Select the project
gcloud config set project YOUR_PROJECT_ID

# 2. Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com

# 3. Make sure you have a local .env with Google OAuth credentials
cd auth-bridge-example
npm run setup   # generates secrets
# Then manually add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, VITE_GOOGLE_CLIENT_ID
```

## Deploy

```bash
cd auth-bridge-example/deploy

# 1. Create Cloud SQL instance (one-time)
./create-db.sh

# 2. Push secrets to Secret Manager (one-time, or after .env changes)
./setup-secrets.sh

# 3. Build & deploy both services
./deploy.sh
```

The deploy script will output the frontend and backend URLs when finished.

## Post-deployment

1. Copy the **frontend URL** from the deploy output
2. In Google Cloud Console → APIs & Credentials → your OAuth client, add:
   - **Authorized JavaScript origins**: the frontend URL
   - **Authorized redirect URIs**: the frontend URL

## Updating

After code changes, just re-run `./deploy.sh`. It rebuilds and redeploys both services.

If you change `.env`, run `./setup-secrets.sh` again to sync secrets.

## Configuration

Environment variables can be set to override defaults:

```bash
REGION=us-west1 ./deploy.sh
CLOUDSQL_INSTANCE=my-db ./create-db.sh
```

## Costs

Rough monthly estimate for a low-traffic demo:
- Cloud Run (2 services, scales to zero): ~$0
- Cloud SQL db-f1-micro: ~$10
- Cloud Storage (images): <$1
- Secret Manager: free tier covers ~10k accesses

Total: ~$10/month when idle, scales with usage.
