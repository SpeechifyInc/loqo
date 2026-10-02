#!/usr/bin/env bash
# One-time GCP setup for loqo on Cloud Run: APIs, image registry, runtime service account, Cloud
# SQL database and the secrets deploy.sh mounts. Idempotent: a re-run only adds what is missing.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
. "$(dirname "${BASH_SOURCE[0]}")/config.sh"

gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com

gcloud artifacts repositories describe "$LOQO_SERVICE" --location "$GCP_REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$LOQO_SERVICE" --location "$GCP_REGION" --repository-format docker

gcloud iam service-accounts describe "$LOQO_RUNTIME_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${LOQO_RUNTIME_SA%%@*}" --display-name "$LOQO_SERVICE on Cloud Run"
gcloud projects add-iam-policy-binding "$CLOUDSQL_PROJECT" --condition None \
  --member "serviceAccount:$LOQO_RUNTIME_SA" --role roles/cloudsql.client >/dev/null

sql=(--instance "$CLOUDSQL_NAME" --project "$CLOUDSQL_PROJECT")
# Shared-core tiers exist only in the Enterprise edition.
gcloud sql instances describe "$CLOUDSQL_NAME" --project "$CLOUDSQL_PROJECT" >/dev/null 2>&1 \
  || gcloud sql instances create "$CLOUDSQL_NAME" --project "$CLOUDSQL_PROJECT" --region "$GCP_REGION" \
       --database-version POSTGRES_17 --edition ENTERPRISE --tier "${LOQO_CLOUDSQL_TIER:-db-g1-small}"
gcloud sql databases describe "$LOQO_SERVICE" "${sql[@]}" >/dev/null 2>&1 \
  || gcloud sql databases create "$LOQO_SERVICE" "${sql[@]}"

put_secret() {
  printf %s "$2" | gcloud secrets create "$(secret_name "$1")" --data-file - --replication-policy automatic >/dev/null
  echo "created secret $(secret_name "$1")"
}

if ! secret_exists DATABASE_URL; then
  if gcloud sql users list "${sql[@]}" --format 'value(name)' | grep -qx "$LOQO_SERVICE"; then
    echo "User $LOQO_SERVICE exists on $CLOUDSQL_NAME but secret $(secret_name DATABASE_URL) does not; create it by hand." >&2
    exit 1
  fi
  password="$(openssl rand -hex 24)"
  gcloud sql users create "$LOQO_SERVICE" "${sql[@]}" --password "$password"
  put_secret DATABASE_URL "postgres://$LOQO_SERVICE:$password@/$LOQO_SERVICE?host=/cloudsql/$CLOUDSQL_CONNECTION"
fi

# The rest come from the environment.
for env_name in "${SECRET_ENV[@]}"; do
  secret_exists "$env_name" && continue
  [ -n "${!env_name:-}" ] || { echo "Set $env_name (or drop it from LOQO_SECRETS) and re-run." >&2; exit 1; }
  put_secret "$env_name" "${!env_name}"
done

for env_name in "${SECRET_ENV[@]}"; do
  gcloud secrets add-iam-policy-binding "$(secret_name "$env_name")" \
    --member "serviceAccount:$LOQO_RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "Setup done. Deploy with deploy/cloud-run/deploy.sh."
