# syntax=docker/dockerfile:1
# Container image of operate: the standalone bundle (one CommonJS file, every runtime
# dependency inlined) on distroless Node.js 24: non-root (nonroot, uid 65532), no shell, no package
# manager. The bundle is the same for every platform, so a multi-platform build only copies it:
#   npm run build:standalone
#   docker build -t operate .
#   docker run --rm operate --version
# Dependabot updates the digest; release.yml builds linux/amd64 and linux/arm64.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:78f07ef1b5ea71ad7c055df15d0dd8997f2d288f9158623c4d4ae3d765b7d50d

# GHCR links the package to the repository through image.source; release.yml adds version,
# revision and creation time and repeats these as annotations of the multi-platform index.
LABEL org.opencontainers.image.title="operate" \
      org.opencontainers.image.description="AI-first command line interface for the Camunda 7 REST API (Operaton, CIB seven, Camunda 7)" \
      org.opencontainers.image.source="https://github.com/Miragon/operate" \
      org.opencontainers.image.url="https://github.com/Miragon/operate#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Miragon GmbH"

COPY build/standalone/operate.cjs /opt/operate/operate.cjs

# Mount the files of deployments and --out-file here: docker run -v "$PWD:/work" ...
WORKDIR /work
ENTRYPOINT ["/nodejs/bin/node", "/opt/operate/operate.cjs"]
