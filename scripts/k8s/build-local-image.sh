#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: ENVIRONMENT=staging|prod scripts/k8s/build-local-image.sh

Builds Linux/amd64 Auth Bridge backend and frontend images on the Evans Creek
runner and pushes them to the local registry.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case "${ENVIRONMENT:-}" in
  staging) env_slug="staging" ;;
  prod | production) env_slug="production" ;;
  *) usage; exit 2 ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

source_sha="${SOURCE_SHA:-$(git rev-parse HEAD)}"
short_sha="${source_sha:0:12}"
image_date="${IMAGE_DATE:-$(date -u +%F)}"
image_tag="${IMAGE_TAG:-${short_sha}-${env_slug}-${image_date}}"
registry_push="${REGISTRY_PUSH:-10.152.183.28:5000}"
registry_pull="${REGISTRY_PULL:-registry.cars-operator-system.svc.cluster.local:5000}"

backend_push="${registry_push}/p2ppsr/auth-bridge-backend:${image_tag}"
frontend_push="${registry_push}/p2ppsr/auth-bridge-frontend:${image_tag}"
backend_pull="${registry_pull}/p2ppsr/auth-bridge-backend:${image_tag}"
frontend_pull="${registry_pull}/p2ppsr/auth-bridge-frontend:${image_tag}"

docker build -f Dockerfile.backend.local -t "${backend_push}" .
docker push "${backend_push}"
docker build -f Dockerfile.frontend.local -t "${frontend_push}" \
  --build-arg "VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-}" .
docker push "${frontend_push}"

cat > release-manifest.json <<EOF
{
  "source_sha": "${source_sha}",
  "environment": "${env_slug}",
  "image_tag": "${image_tag}",
  "backend_image": "${backend_pull}",
  "frontend_image": "${frontend_pull}"
}
EOF

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'image_tag=%s\n' "${image_tag}"
    printf 'backend_image=%s\n' "${backend_pull}"
    printf 'frontend_image=%s\n' "${frontend_pull}"
  } >> "${GITHUB_OUTPUT}"
fi

printf 'Pushed images:\n  %s\n  %s\n' "${backend_pull}" "${frontend_pull}"
