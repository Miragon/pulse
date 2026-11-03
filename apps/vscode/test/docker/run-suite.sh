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

if [ "$suite" = e2e ]; then
  # The e2e suite and its workspace name the engine as localhost:18080; the container shares the
  # engine container's network, where the engine listens on 8080.
  node -e 'const net = require("node:net"); net.createServer((client) => { const engine = net.connect(8080, "127.0.0.1"); client.pipe(engine).pipe(client); engine.on("error", () => client.destroy()); client.on("error", () => engine.destroy()) }).listen(18080, "127.0.0.1")' &
fi

cd apps/vscode
exec xvfb-run -a -s "-screen 0 1920x1200x24" pnpm run "test:${suite}"
