#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  sed "s|\$(pwd)|$(pwd)|g" .env.example > .env
  echo "Created .env from .env.example"
fi

pnpm install --frozen-lockfile

pnpm --fail-if-no-match -F @miragon/pulse-engine-client generate

pnpm build

if [ -z "${JAVA_HOME:-}" ] && ! command -v java >/dev/null 2>&1; then
  echo "Error: java not found on PATH and JAVA_HOME is unset. Install a JDK to build the engine plugins." >&2
  exit 1
fi

(cd engine-plugins && ./gradlew build -x test)
