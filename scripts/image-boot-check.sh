#!/usr/bin/env bash
# Starts the server image once and proves it on the platform it was built for: the image's own
# HEALTHCHECK turns healthy, the MCP endpoint lists its tools and serves a view resource with the
# widget bundle in it. Readiness reads no engine, so an engine nobody listens on is enough to boot.
# .github/workflows/docker-build.yml runs it on amd64 and arm64; locally, after a docker build:
#
#   scripts/image-boot-check.sh pulse-server:local
set -euo pipefail

IMAGE=${1:?usage: scripts/image-boot-check.sh <image>}
NAME="pulse-boot-check-$$"
# The HEALTHCHECK's first probe runs one interval (30 s) after the start.
HEALTHY_WITHIN_S=${HEALTHY_WITHIN_S:-180}

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  docker logs "$NAME" >&2 || true
  echo "::error::$1" >&2
  exit 1
}

docker run -d --name "$NAME" -p 127.0.0.1::8400 \
  -e ENGINE_BASE_URL=http://127.0.0.1:9/engine-rest -e ENGINE_ID=boot-check \
  "$IMAGE" >/dev/null

status=starting
deadline=$((SECONDS + HEALTHY_WITHIN_S))
while ((SECONDS < deadline)); do
  [ "$(docker inspect --format '{{.State.Running}}' "$NAME")" = true ] ||
    fail "The image exited before it turned healthy"
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME")"
  [ -n "$status" ] || fail "The image declares no HEALTHCHECK"
  [ "$status" = healthy ] && break
  sleep 3
done
[ "$status" = healthy ] || fail "The image did not turn healthy within ${HEALTHY_WITHIN_S} s (${status})"
echo "healthy on $(docker exec "$NAME" node --version), $(docker exec "$NAME" uname -m)"

port="$(docker port "$NAME" 8400/tcp | awk -F: 'NR == 1 { print $NF }')"
mcp() {
  curl -sS --fail-with-body --max-time 30 -X POST "http://127.0.0.1:${port}/mcp" \
    -H 'Host: localhost' -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" |
    awk '!found && sub(/^data: /, "") { print; found = 1 } !found && /^\{/ { print; found = 1 }'
}

tools="$(mcp tools/list '{}' | jq -r '.result.tools | length')"
[ "${tools:-0}" -gt 0 ] || fail "tools/list answered no tool"
echo "tools/list: ${tools} tools"

uri="$(mcp resources/list '{}' | jq -r '[.result.resources[].uri | select(startswith("ui://views/"))][0] // empty')"
[ -n "$uri" ] || fail "resources/list answered no view resource (ui://views/)"
size="$(mcp resources/read "{\"uri\":\"${uri}\"}" | jq -r '[.result.contents[].text // empty] | map(length) | add // 0')"
# The view resource inlines the widget bundle (test/__golden__/bundle-budget.json): far more than a
# page shell.
[ "$size" -gt 100000 ] || fail "${uri} holds ${size} characters, no widget bundle"
echo "resources/read ${uri}: ${size} characters"
