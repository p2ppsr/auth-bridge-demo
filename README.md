# Auth Bridge Example

A demo of [`@bsv/auth-bridge-express`](./packages/auth-bridge-express) and [`@bsv/auth-bridge-react`](./packages/auth-bridge-react) — letting users log in with Google or email, create encrypted on-chain todos via a server-managed BRC-100 wallet, and migrate to a self-sovereign BRC-100 wallet when ready.

## Structure

```
├── packages/
│   ├── auth-bridge-express/   # Backend middleware (mounts auth routes, manages wallets)
│   └── auth-bridge-react/     # React components (drop-in login + migration UI)
├── backend/                   # Example Express server
├── frontend/                  # Example Vite + React app
├── deploy/                    # Cloud Run deployment scripts
└── .github/workflows/         # GitHub Actions: push to main → deploy
```

## Local development

```bash
# 1. Generate secrets + MySQL credentials
npm run setup

# 2. (Optional) Add Google OAuth credentials to .env
#    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, VITE_GOOGLE_CLIENT_ID

# 3. Start MySQL
npm run db:up

# 4. Install deps
npm run install:all

# 5. Run (two terminals)
npm run dev:backend
npm run dev:frontend
```

Open <http://localhost:5173>. Magic link URLs print to the backend console for local email auth.

## Deploy to Google Cloud Run

### One-time setup

```bash
# 1. Create Cloud SQL instance + DB
./deploy/create-db.sh

# 2. Push .env secrets to Secret Manager (app runtime)
./deploy/setup-secrets.sh

# 3. Set up Workload Identity Federation for GitHub Actions
GITHUB_REPO=your-user/your-repo ./deploy/setup-wif.sh

# 4. Push GitHub secrets for the Actions workflow
./deploy/push-github-secrets.sh
```

### Deploy

Just push to `main`:

```bash
git push origin main
```

GitHub Actions builds the backend and frontend images, pushes to GCR, deploys to Cloud Run, and wires up the URLs automatically.

You can also deploy manually without CI/CD:

```bash
./deploy/deploy.sh
```

### Post-deploy

Copy the frontend URL from the GitHub Actions summary or `deploy.sh` output and add it to your Google OAuth client's authorized JavaScript origins and redirect URIs.

## GitHub secrets required

These are set automatically by `./deploy/push-github-secrets.sh`:

| Secret | Purpose |
|--------|---------|
| `GCP_PROJECT_ID` | GCP project to deploy into |
| `GCP_SERVICE_ACCOUNT` | Service account the workflow impersonates |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF provider resource name |
| `VITE_GOOGLE_CLIENT_ID` | Baked into the SPA at build time |

App runtime secrets (DB password, wallet keys, Google OAuth client secret) live in Google Secret Manager, not GitHub. Cloud Run mounts them as env vars at runtime via `--set-secrets`.

## Costs

- Cloud Run (scales to zero when idle): ~$0
- Cloud SQL `db-f1-micro`: ~$10/month
- GCR image storage + Cloud Build: <$1/month for low-volume CI

~$10/month idle, scales with usage.
