#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Installs, starts the playground (engine, OTEL Collector, Prometheus, Grafana), builds and runs
# the MCP server on :8400 against it; no .env needed (scripts/local.mjs).
exec pnpm play
