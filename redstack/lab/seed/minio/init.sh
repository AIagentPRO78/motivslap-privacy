#!/usr/bin/env bash
# Seed the lab minio with a public bucket + fake terraform state file.
# All credentials and secrets are synthetic (FAKEKEYLAB* prefix).
set -euo pipefail

MINIO_ENDPOINT="http://127.0.0.1:9000"
MINIO_USER="FAKEKEYLABADMIN"
MINIO_PASS="FAKEKEYLABADMINSECRET"
BUCKET="lab-public"

# Wait for minio readiness (up to 30s).
for _ in $(seq 1 30); do
  curl -fsS "${MINIO_ENDPOINT}/minio/health/ready" >/dev/null 2>&1 && break
  sleep 1
done

# Use the minio client via docker to avoid a brew dep.
mc() {
  docker run --rm --network host \
    -e MC_HOST_lab="http://${MINIO_USER}:${MINIO_PASS}@127.0.0.1:9000" \
    --entrypoint /usr/bin/mc minio/mc:latest "$@"
}

mc mb --ignore-existing lab/${BUCKET}
mc anonymous set public lab/${BUCKET}

# Deliberately-leaked fake terraform state file.
TMP="$(mktemp)"
cat > "$TMP" <<'JSON'
{
  "version": 4,
  "terraform_version": "1.7.0",
  "outputs": {
    "lab_db_endpoint": { "value": "postgres-lab.example.invalid:5432" },
    "lab_api_key":     { "value": "FAKEKEYLABAPIKEYEXPOSED" }
  },
  "resources": [
    {
      "type": "example_iam_access_key",
      "name": "ci_deployer",
      "instances": [{
        "attributes": {
          "id":     "FAKEKEYLABAK000000001",
          "secret": "FAKEKEYLABSK00000000000000000000000001"
        }
      }]
    }
  ]
}
JSON
mc cp "$TMP" lab/${BUCKET}/terraform.tfstate
rm -f "$TMP"

# Deliberately-leaked fake internal config.
TMP="$(mktemp)"
cat > "$TMP" <<'YAML'
# Internal lab config (intentionally public in this misconfiguration scenario)
endpoints:
  idp: http://auth.lab.example.invalid
  db:  postgres-lab.example.invalid:5432
credentials:
  idp_admin_token: FAKEKEYLABIDPTOKEN
YAML
mc cp "$TMP" lab/${BUCKET}/internal-config.yaml
rm -f "$TMP"

echo "==> minio seeded: ${MINIO_ENDPOINT}/${BUCKET}/"
