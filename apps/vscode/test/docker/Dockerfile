# VS Code under Xvfb for the extension's smoke and e2e suites, run by scripts/docker-test.mjs:
# Node 22 as in CI, plus the libraries VS Code's Electron needs on Linux.
FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates rsync xauth xvfb \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnss3 \
    libsecret-1-0 libxkbfile1 libxshmfence1 libxss1 \
  && rm -rf /var/lib/apt/lists/*

ARG PNPM_VERSION
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

ENV CI=1 HUSKY=0
WORKDIR /work
