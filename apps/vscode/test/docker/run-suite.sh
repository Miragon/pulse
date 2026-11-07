#!/usr/bin/env bash
# Runs inside the image of test/docker/Dockerfile: copies the read-only checkout (/src) into the
# container's own working copy (/work, a volume that keeps node_modules and the VS Code download
# between runs), installs and builds the extension, then runs one suite under Xvfb.
set -euo pipefail

suite="$1"

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .turbo --exclude dist --exclude .vscode-test \
  --exclude test-results --exclude reports --exclude coverage \
  /src/ /work/
cd /work

pnpm config set store-dir /pnpm-store >/dev/null
pnpm install --frozen-lockfile --filter "pulse-cockpit..." --filter .
pnpm --fail-if-no-match --filter "pulse-cockpit^..." run build

# Forwards a loopback port to a host and port this container's network reaches.
forward() {
  node -e 'const net = require("node:net"); const [from, host, to] = process.argv.slice(1); net.createServer((client) => { const target = net.connect(Number(to), host); client.pipe(target).pipe(client); target.on("error", () => client.destroy()); client.on("error", () => target.destroy()) }).listen(Number(from), "127.0.0.1")' "$@" &
}

# The e2e suites and their workspaces name the engine by the ports of the host; the container
# shares the engine container's network, where the engine listens on 8080.
if [ "$suite" = e2e ]; then
  forward 18080 127.0.0.1 8080
fi
if [ "$suite" = e2e:c8 ]; then
  forward 18088 127.0.0.1 8080
  forward 18089 keycloak 8080
fi

cd apps/vscode
exec xvfb-run -a -s "-screen 0 1920x1200x24" pnpm run "test:${suite}"
