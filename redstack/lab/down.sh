#!/usr/bin/env bash
# Tear down the redstack M2 lab.
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$LAB_DIR"

echo "==> redstack lab: deleting k3d cluster"
k3d cluster delete redstack-lab 2>/dev/null || true

echo "==> redstack lab: docker compose down --volumes"
docker compose down --volumes --remove-orphans

echo "==> redstack lab: scrubbed"
