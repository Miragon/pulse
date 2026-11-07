# syntax=docker/dockerfile:1.7
# Mirrors the stock Pulse server image (two-stage pnpm build). Requires a
# committed pnpm-lock.yaml: run `pnpm install` and commit it if it changed.

FROM node:26-slim AS base

RUN npm install -g pnpm@10.32.1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

FROM base AS build
WORKDIR /app

# The pnpm store (/pnpm/store, derived from PNPM_HOME) must live IN the layer, never in a
# `--mount=type=cache`: registry caches persist layers but not cache mounts, so a cache-hit
# on this step would skip `pnpm fetch` and leave the store empty, and the `--offline` install
# below then fails with ERR_PNPM_NO_OFFLINE_TARBALL.
COPY pnpm-lock.yaml .npmrc ./
RUN pnpm fetch

COPY package.json pnpm-workspace.yaml ./
COPY server/ server/
COPY modules/ modules/

RUN pnpm install --frozen-lockfile --offline

RUN pnpm run build

# Selected by path, not by name: renaming the @acme scope needs no edit here.
# pnpm 10's default deploy only takes a workspace with inject-workspace-packages=true, which this
# one does not set, so --legacy picks the former implementation. pnpm says so on every build,
# as expected: "WARN Shared workspace lockfile detected but configuration forces legacy deploy
# implementation." A prom-client deprecation warning, when one shows, comes from a dependency.
RUN pnpm --filter ./server deploy --prod --legacy /app/deployed

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/deployed .
COPY --from=build /app/server/dist ./dist

ENV NODE_ENV=production
EXPOSE 8400

USER node

# Readiness over HTTP: /health/ready answers 200 once the MCP transport serves
# and 503 while it drains; /health/live is the liveness-only variant. Node's
# global fetch keeps the image curl-free.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8400)+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/index.js"]
