# shellcheck shell=bash disable=SC2034
# Settings shared by setup.sh and deploy.sh, which source this file; each can be overridden from the environment.
: "${GCP_PROJECT:?Set GCP_PROJECT to the project Cloud Run runs in.}"
GCP_REGION="${GCP_REGION:-us-central1}"
LOQO_SERVICE="${LOQO_SERVICE:-loqo}"
LOQO_RUNTIME_SA="${LOQO_RUNTIME_SA:-$LOQO_SERVICE-run@$GCP_PROJECT.iam.gserviceaccount.com}"
LOQO_REGISTRY="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$LOQO_SERVICE"
LOQO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# An instance name in GCP_PROJECT, or the `project:region:instance` connection name of one elsewhere.
LOQO_CLOUDSQL_INSTANCE="${LOQO_CLOUDSQL_INSTANCE:-$LOQO_SERVICE}"
if [[ "$LOQO_CLOUDSQL_INSTANCE" == *:* ]]; then
  CLOUDSQL_CONNECTION="$LOQO_CLOUDSQL_INSTANCE"
else
  CLOUDSQL_CONNECTION="$GCP_PROJECT:$GCP_REGION:$LOQO_CLOUDSQL_INSTANCE"
fi
IFS=: read -r CLOUDSQL_PROJECT _ CLOUDSQL_NAME <<< "$CLOUDSQL_CONNECTION"

# Mounted from Secret Manager as `<service>-<name-in-kebab-case>`, e.g. loqo-database-url.
SECRET_ENV=(DATABASE_URL GOOGLE_CLIENT_SECRET OPENAI_API_KEY ANTHROPIC_API_KEY)
secret_name() { echo "$LOQO_SERVICE-$(printf %s "$1" | tr 'A-Z_' 'a-z-')"; }
secret_exists() { gcloud secrets describe "$(secret_name "$1")" >/dev/null 2>&1; }

export CLOUDSDK_CORE_PROJECT="$GCP_PROJECT" CLOUDSDK_CORE_DISABLE_PROMPTS=1
