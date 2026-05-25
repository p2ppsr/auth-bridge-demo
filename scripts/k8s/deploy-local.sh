#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: ENVIRONMENT=staging|prod IMAGE_TAG=<tag> scripts/k8s/deploy-local.sh

Applies the Auth Bridge Kubernetes overlay and creates/updates auth-bridge-secrets.

Required secret env:
  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME SERVER_WALLET_KEY AUTH_BRIDGE_KEY
  AUTH_BRIDGE_JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET FUNDING_WALLET_KEY

Optional:
  FUND_AMOUNT_SATS REGISTRY_PULL KUBECTL DRY_RUN WAIT_FOR_CERT
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case "${ENVIRONMENT:-}" in
  staging)
    env_slug="staging"
    namespace="auth-bridge-staging"
    overlay="staging"
    frontend_host="staging-auth-bridge.babbage.systems"
    backend_host="staging-auth-bridge-api.babbage.systems"
    ;;
  prod | production)
    env_slug="production"
    namespace="auth-bridge-prod"
    overlay="prod"
    frontend_host="auth-bridge.babbage.systems"
    backend_host="auth-bridge-api.babbage.systems"
    ;;
  *) usage; exit 2 ;;
esac

required_vars=(
  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME SERVER_WALLET_KEY AUTH_BRIDGE_KEY
  AUTH_BRIDGE_JWT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET FUNDING_WALLET_KEY
)
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "${var_name}" >&2
    exit 2
  fi
done

if [[ -z "${IMAGE_TAG:-}" ]]; then
  if [[ -z "${SOURCE_SHA:-}" ]]; then
    usage
    exit 2
  fi
  IMAGE_TAG="${SOURCE_SHA:0:12}-${env_slug}-$(date -u +%F)"
fi

repo_root="$(git rev-parse --show-toplevel)"
registry_pull="${REGISTRY_PULL:-registry.cars-operator-system.svc.cluster.local:5000}"
kubectl_cmd="${KUBECTL:-kubectl}"
dry_run="${DRY_RUN:-}"
wait_for_cert="${WAIT_FOR_CERT:-true}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
mkdir -p "${tmp_dir}/infra"
cp -R "${repo_root}/infra/kubernetes" "${tmp_dir}/infra/kubernetes"
overlay_dir="${tmp_dir}/infra/kubernetes/overlays/${overlay}"
kustomization="${overlay_dir}/kustomization.yaml"

export IMAGE_TAG REGISTRY_PULL="${registry_pull}"
perl -0pi -e 's#newName: [^\n]*/p2ppsr/auth-bridge-backend#newName: $ENV{REGISTRY_PULL}/p2ppsr/auth-bridge-backend#g' "${kustomization}"
perl -0pi -e 's#newName: [^\n]*/p2ppsr/auth-bridge-frontend#newName: $ENV{REGISTRY_PULL}/p2ppsr/auth-bridge-frontend#g' "${kustomization}"
perl -0pi -e 's#newTag: [^\n]+#newTag: $ENV{IMAGE_TAG}#g' "${kustomization}"

secret_env_file="${tmp_dir}/auth-bridge-secrets.env"
umask 077
for var_name in "${required_vars[@]}"; do
  printf '%s=%s\n' "${var_name}" "${!var_name}" >> "${secret_env_file}"
done
printf 'FUND_AMOUNT_SATS=%s\n' "${FUND_AMOUNT_SATS:-5000}" >> "${secret_env_file}"

if [[ -n "${dry_run}" ]]; then
  "${kubectl_cmd}" apply --dry-run="${dry_run}" -f "${overlay_dir}/namespace.yaml"
  "${kubectl_cmd}" -n "${namespace}" create secret generic auth-bridge-secrets \
    --from-env-file="${secret_env_file}" --dry-run=client -o yaml | \
    "${kubectl_cmd}" apply --dry-run="${dry_run}" -f -
  "${kubectl_cmd}" kustomize "${overlay_dir}" | "${kubectl_cmd}" apply --dry-run="${dry_run}" -f -
  exit 0
fi

"${kubectl_cmd}" apply -f "${overlay_dir}/namespace.yaml"
"${kubectl_cmd}" -n "${namespace}" create secret generic auth-bridge-secrets \
  --from-env-file="${secret_env_file}" --dry-run=client -o yaml | "${kubectl_cmd}" apply -f -
"${kubectl_cmd}" kustomize "${overlay_dir}" | "${kubectl_cmd}" apply -f -
"${kubectl_cmd}" -n "${namespace}" rollout status deployment/auth-bridge-backend --timeout=10m
"${kubectl_cmd}" -n "${namespace}" rollout status deployment/auth-bridge-frontend --timeout=10m
if [[ "${wait_for_cert}" != "false" ]]; then
  "${kubectl_cmd}" -n "${namespace}" wait --for=condition=Ready certificate/auth-bridge-backend-tls --timeout=15m
  "${kubectl_cmd}" -n "${namespace}" wait --for=condition=Ready certificate/auth-bridge-frontend-tls --timeout=15m
fi

curl_pod="auth-bridge-smoke-${env_slug}-$(date +%s)"
"${kubectl_cmd}" -n "${namespace}" run "${curl_pod}" --quiet --rm -i --restart=Never \
  --image=curlimages/curl:8.11.1 --command -- sh -ec '
    backend="$(curl --fail --show-error --silent http://auth-bridge-backend:8080/healthz)"
    printf "%s" "${backend}" | grep -q "\"ok\":true"
    curl --fail --show-error --silent --output /dev/null http://auth-bridge-backend:8080/health
    curl --fail --show-error --silent --output /dev/null http://auth-bridge-frontend:8080/
    curl --show-error --silent --output /tmp/auth.out --write-out "%{http_code}" http://auth-bridge-frontend:8080/auth > /tmp/auth.code
    grep -Eq "^(200|302|400|404)$" /tmp/auth.code
  '

printf 'Auth Bridge %s deployment completed: frontend=%s backend=%s image_tag=%s\n' \
  "${env_slug}" "${frontend_host}" "${backend_host}" "${IMAGE_TAG}"
