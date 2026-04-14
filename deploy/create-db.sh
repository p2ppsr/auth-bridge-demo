#!/bin/bash
# Create Cloud SQL instance for auth-bridge-example
# Usage: ./create-db.sh

set -e

PROJECT_ID=$(gcloud config get-value project)
REGION="${REGION:-us-central1}"
INSTANCE_NAME="${CLOUDSQL_INSTANCE:-auth-bridge-db}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-$(openssl rand -hex 16)}"
DB_USER_PASSWORD="${DB_USER_PASSWORD:-$(openssl rand -hex 16)}"

echo "Creating Cloud SQL instance '$INSTANCE_NAME' in $REGION..."
gcloud sql instances create "$INSTANCE_NAME" \
  --database-version=MYSQL_8_0 \
  --region="$REGION" \
  --tier=db-f1-micro \
  --root-password="$DB_ROOT_PASSWORD" \
  --no-assign-ip \
  --network=default || echo "(instance may already exist, continuing)"

echo "Creating database 'auth_bridge'..."
gcloud sql databases create auth_bridge \
  --instance="$INSTANCE_NAME" || echo "(database may already exist)"

echo "Creating user 'authbridge'..."
gcloud sql users create authbridge \
  --instance="$INSTANCE_NAME" \
  --password="$DB_USER_PASSWORD" || echo "(user may already exist)"

# Store password in Secret Manager
echo "Storing DB password in Secret Manager..."
echo -n "$DB_USER_PASSWORD" | gcloud secrets create db-password --data-file=- 2>/dev/null \
  || echo -n "$DB_USER_PASSWORD" | gcloud secrets versions add db-password --data-file=-

CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Cloud SQL ready"
echo "  Instance: $INSTANCE_NAME"
echo "  Connection name: $CONNECTION_NAME"
echo "  Database: auth_bridge"
echo "  User: authbridge"
echo "  Password stored in Secret Manager as 'db-password'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
