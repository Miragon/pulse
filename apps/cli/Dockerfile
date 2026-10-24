# syntax=docker/dockerfile:1
# The Pulse CLI image: the standalone bundle (one CommonJS file, every runtime dependency
# inlined) on distroless Node.js 24: non-root (nonroot, uid 65532), no shell, no package
# manager. The bundle is the same for every platform, so a multi-platform build only copies it
# (no RUN, so no emulation). The build context is apps/cli, where .dockerignore admits only the
# bundle:
#   pnpm --fail-if-no-match --filter @miragon/pulse-cli run build:standalone
#   docker build -t pulse-cli apps/cli
#   docker run --rm pulse-cli --version
# Dependabot updates the digest (.github/dependabot.yml, directory /apps/cli). ci.yml builds and
# smoke-tests the image on every pull request, .github/workflows/publish-cli.yml pushes
# ghcr.io/miragon/pulse-cli on a release.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8

# GHCR links the package to the repository through image.source; publish-cli.yml adds the
# version, revision and creation time and repeats these as annotations of the multi-platform
# index.
LABEL org.opencontainers.image.title="pulse-cli" \
      org.opencontainers.image.description="Pulse CLI: the Camunda 7 REST API from the command line, for Operaton, CIB seven and Camunda 7" \
      org.opencontainers.image.source="https://github.com/Miragon/pulse" \
      org.opencontainers.image.url="https://miragon.github.io/pulse/cli/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Miragon GmbH"

COPY build/standalone/pulse-cli.cjs /opt/pulse-cli/pulse-cli.cjs

# Mount the files of deployments and --out-file here: docker run -v "$PWD:/work" ...
WORKDIR /work
ENTRYPOINT ["/nodejs/bin/node", "/opt/pulse-cli/pulse-cli.cjs"]
