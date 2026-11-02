#!/usr/bin/env sh
# Refresh cibseven-open-api-doc.json from the official CIB Seven OpenAPI
# artifact on Maven Central (org.cibseven.bpm:cibseven-engine-rest-openapi).
# The engine itself does not serve its spec over HTTP — the artifact jar
# (which contains openapi.json) is the canonical published source.
#
# Note: the spec SOURCE is the CIB Seven jar, but the SURFACE is the standard
# Camunda 7 engine-rest API (no CIB-Seven-only endpoints) — the generated SDK
# works unchanged against any C7-lineage engine (CIB Seven, Operaton, Camunda 7).
#
# Usage: pnpm spec:refresh <version>   e.g. pnpm spec:refresh 2.2.0
# Afterwards: pnpm generate, review the git diff, commit spec + generated code.
set -eu

cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: pnpm spec:refresh <engine-version>   (e.g. pnpm spec:refresh 2.2.0)" >&2
  echo "Published versions: https://repo1.maven.org/maven2/org/cibseven/bpm/cibseven-engine-rest-openapi/" >&2
  exit 1
fi

ARTIFACT="cibseven-engine-rest-openapi-${VERSION}.jar"
URL="https://repo1.maven.org/maven2/org/cibseven/bpm/cibseven-engine-rest-openapi/${VERSION}/${ARTIFACT}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ${URL}"
curl -fsSL "$URL" -o "${TMP_DIR}/${ARTIFACT}"
unzip -p "${TMP_DIR}/${ARTIFACT}" openapi.json > cibseven-open-api-doc.json

echo "Wrote cibseven-open-api-doc.json (artifact version ${VERSION})."
echo "Next: pnpm generate && git diff — review the regenerated SDK before committing."
