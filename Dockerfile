# syntax=docker/dockerfile:1.7

FROM node:26-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS base

RUN npm install -g pnpm@10.32.1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV TURBO_NO_UPDATE_NOTIFIER=1
ENV CI=true

FROM base AS build
WORKDIR /app

# The pnpm store (/pnpm/store, derived from PNPM_HOME) must live IN the layer, never in a
# `--mount=type=cache`: registry caches (`cache-to: type=gha`) persist layers but not cache
# mounts, so a cache-hit on this step would skip `pnpm fetch` and leave the store empty —
# the `--offline` install below then fails with ERR_PNPM_NO_OFFLINE_TARBALL.
COPY pnpm-lock.yaml .npmrc ./
RUN pnpm fetch

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN pnpm install --frozen-lockfile --offline

# Turbo's cache is a pure accelerator — an empty one only means a slower build.
RUN --mount=type=cache,id=turbo-server,target=/app/.turbo \
    pnpm turbo build --filter=@miragon/pulse-mcp-server-camunda7...

RUN pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server-camunda7 deploy --prod --legacy /app/deployed

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/deployed .
COPY --from=build /app/apps/mcp-server-camunda7/dist ./dist

ENV NODE_ENV=production
EXPOSE 8400

USER node

# Readiness over HTTP: /health/ready answers 200 once the MCP transport serves
# and 503 while it drains, the same route Compose and Fly poll; /health/live is
# the liveness-only variant for orchestrators that split the two. Node's global
# fetch keeps the image curl-free.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8400)+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/index.js"]
