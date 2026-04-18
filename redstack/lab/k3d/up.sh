#!/usr/bin/env bash
# Create the redstack-lab k3d cluster and apply deliberately vulnerable
# manifests for the /cloud-audit skill to find.
set -euo pipefail

K3D_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$K3D_DIR"

if k3d cluster list 2>/dev/null | grep -q '^redstack-lab '; then
  echo "==> k3d: redstack-lab cluster already present"
else
  # API on 127.0.0.1:6443; single-node; traefik disabled to keep the
  # exposed surface small — only what we deliberately expose counts.
  k3d cluster create redstack-lab \
    --api-port 127.0.0.1:6443 \
    --servers 1 --agents 0 \
    --k3s-arg "--disable=traefik@server:0" \
    --wait
fi

kubectl config use-context k3d-redstack-lab >/dev/null

echo "==> k3d: applying vulnerable manifests"
kubectl apply -f manifests/cluster-admin-sa.yaml
kubectl apply -f manifests/privileged-pod.yaml
kubectl apply -f manifests/public-service.yaml

echo "==> k3d: cluster ready (kubectl --context k3d-redstack-lab ...)"
