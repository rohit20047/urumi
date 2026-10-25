#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
k3d cluster create --config "$project_dir/k3d/cluster.yaml"
kubectl config use-context k3d-urumi-local
kubectl config set-context k3d-urumi-local --namespace=urumi
kubectl label node k3d-urumi-local-agent-0 node-role.kubernetes.io/worker=true --overwrite
kubectl wait --for=condition=Ready nodes --all --timeout=180s
