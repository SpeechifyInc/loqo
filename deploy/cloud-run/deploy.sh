#!/usr/bin/env bash
# Builds this checkout (or takes LOQO_IMAGE) and rolls it out to Cloud Run. Run setup.sh once first.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
. "$(dirname "${BASH_SOURCE[0]}")/config.sh"

: "${GOOGLE_CLIENT_ID:?Set GOOGLE_CLIENT_ID.}"

image="${LOQO_IMAGE:-}"
if [ -z "$image" ]; then
  image="$LOQO_REGISTRY/$LOQO_SERVICE:$(git -C "$LOQO_ROOT" describe --always --dirty)"
  gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" >/dev/null 2>&1
  docker buildx build --platform linux/amd64 --push -t "$image" "$LOQO_ROOT"
fi

app_url="${LOQO_APP_URL:-}"
if [ -z "$app_url" ]; then
  project_number="$(gcloud projects describe "$GCP_PROJECT" --format 'value(projectNumber)')"
  app_url="https://$LOQO_SERVICE-$project_number.$GCP_REGION.run.app"
fi

env_vars=("ROLE=all" "APP_URL=$app_url" "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID")
for name in DATABASE_POOL_SIZE TRANSLATE_BATCH_SIZE TRANSLATE_CONCURRENCY TRANSLATE_MAX_RETRIES TRANSLATE_CONFIG; do
  if [ -n "${!name:-}" ]; then env_vars+=("$name=${!name}"); fi
done
secrets=()
# Not probed: a deployer with only secretAccessor can't see whether a secret exists.
for name in "${SECRET_ENV[@]}"; do secrets+=("$name=$(secret_name "$name"):latest"); done
join() { local IFS=,; echo "$*"; }

# The worker polls the queue between requests, so CPU stays allocated and one instance stays up.
# Every boot runs migrations without a lock: raise max instances only once that is safe.
gcloud run deploy "$LOQO_SERVICE" \
  --image "$image" \
  --region "$GCP_REGION" \
  --service-account "$LOQO_RUNTIME_SA" \
  --set-cloudsql-instances "$CLOUDSQL_CONNECTION" \
  --set-env-vars "$(join "${env_vars[@]}")" \
  --set-secrets "$(join "${secrets[@]}")" \
  --port 3000 \
  --cpu 1 --memory 1Gi --cpu-boost \
  --no-cpu-throttling \
  --min-instances "${LOQO_MIN_INSTANCES:-1}" \
  --max-instances "${LOQO_MAX_INSTANCES:-1}" \
  --timeout 300 \
  --allow-unauthenticated

for _ in $(seq 1 30); do
  if curl -sf --max-time 10 "$app_url/api/health" >/dev/null; then
    echo "loqo is up at $app_url (OAuth redirect URI: $app_url/api/auth/google/callback)"
    exit 0
  fi
  sleep 10
done
echo "$app_url/api/health did not answer within 5 minutes." >&2
exit 1
