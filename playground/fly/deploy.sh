#!/usr/bin/env bash
# Deploys the playground stack to Fly.io — one Fly app per service, wired over
# the org's private 6PN network. Used by .github/workflows/deploy-playground.yml
# and runnable locally (needs flyctl and a Fly token).
#
# Usage: playground/fly/deploy.sh [all|otel|engine|prometheus|grafana|server]
#
# Notes:
# - Apps are created on first use, so the Fly token must be org-scoped
#   (`fly tokens create org -o miragon`), not app-scoped.
# - The engine image copies a pre-built jar: run
#   `(cd playground/cibseven-example && ./gradlew bootJar)` before `engine`/`all`.
# - flyctl resolves --config relative to the build-context working directory,
#   hence the cd-into-context + relative-config pattern below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-all}"
FLY_ORG="${FLY_ORG:-miragon}"

ensure_app() {
  local app="$1"
  if ! flyctl status --app "$app" >/dev/null 2>&1; then
    echo "==> creating app $app (org: $FLY_ORG)"
    flyctl apps create "$app" --org "$FLY_ORG"
  fi
}

deploy() {
  local app="$1" context="$2" config="$3"
  shift 3
  echo "==> deploying $app"
  ensure_app "$app"
  (cd "$ROOT/$context" && flyctl deploy --config "$config" --remote-only --ha=false "$@")
}

deploy_otel() {
  deploy miragon-ai-playground-otel playground/docker/otel ../../fly/otel.fly.toml
}

deploy_engine() {
  local jar="$ROOT/playground/cibseven-example/build/libs/cibseven-example.jar"
  if [[ ! -f "$jar" ]]; then
    echo "missing $jar — run (cd playground/cibseven-example && ./gradlew bootJar) first" >&2
    exit 1
  fi
  deploy miragon-ai-playground-engine playground/cibseven-example ../fly/engine.fly.toml
}

deploy_prometheus() {
  deploy miragon-ai-playground-prometheus playground/docker/prometheus ../../fly/prometheus.fly.toml
}

deploy_grafana() {
  deploy miragon-ai-playground-grafana playground/docker/grafana ../../fly/grafana.fly.toml
}

deploy_server() {
  deploy miragon-ai-playground . playground/fly/server-camunda7.fly.toml
}

case "$TARGET" in
  otel) deploy_otel ;;
  engine) deploy_engine ;;
  prometheus) deploy_prometheus ;;
  grafana) deploy_grafana ;;
  server) deploy_server ;;
  all)
    # Order matters: the engine pushes to the Collector from boot, Prometheus
    # scrapes it, and the server discovers engine and Prometheus.
    deploy_otel
    deploy_engine
    deploy_prometheus
    deploy_grafana
    deploy_server
    ;;
  *)
    echo "unknown target: $TARGET (expected all|otel|engine|prometheus|grafana|server)" >&2
    exit 1
    ;;
esac

echo "==> done"
