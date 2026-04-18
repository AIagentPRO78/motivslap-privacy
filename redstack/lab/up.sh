#!/usr/bin/env bash
# Bring up the redstack M2 lab on a MacBook.
#
# Safety: every component binds to 127.0.0.1 and uses fake credentials
# prefixed with FAKEKEYLAB. Never run this on a host that is reachable
# from the internet.
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$LAB_DIR"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing: $1" >&2
    echo "install via: $2" >&2
    exit 1
  }
}

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "redstack lab is MacBook-only (darwin). Detected: $(uname -s)" >&2
  exit 1
}

require docker "OrbStack (recommended) or Docker Desktop"
require k3d    "brew install k3d"
require kubectl "brew install kubectl"

echo "==> redstack lab: docker compose up"
docker compose up -d --wait

echo "==> redstack lab: seeding minio"
./seed/minio/init.sh

echo "==> redstack lab: k3d cluster + vulnerable manifests"
./k3d/up.sh

echo
echo "==> redstack lab is live (127.0.0.1-only)"
printf '  %-16s %s\n' "DVWA:"            "http://127.0.0.1:8080  (admin / password)"
printf '  %-16s %s\n' "minio console:"   "http://127.0.0.1:9001  (FAKEKEYLABADMIN / FAKEKEYLABADMINSECRET)"
printf '  %-16s %s\n' "minio S3 API:"    "http://127.0.0.1:9000  (public bucket: lab-public)"
printf '  %-16s %s\n' "Postgres:"        "postgres://labuser:FAKEKEYLABPGSECRET@127.0.0.1:5432/lab"
printf '  %-16s %s\n' "Keycloak:"        "http://127.0.0.1:8081  (admin / FAKEKEYLABKCADMIN)"
printf '  %-16s %s\n' "k3d cluster:"     "kubectl config use-context k3d-redstack-lab"
echo
echo "Tear down when done: ./down.sh"
