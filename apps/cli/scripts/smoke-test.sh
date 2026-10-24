#!/usr/bin/env bash
# Smoke test of a packaged pulse-cli without an engine: a standalone executable, the
# container image or any other command line that starts the CLI and forwards stdin.
#
#   scripts/smoke-test.sh build/bin/pulse-cli-linux-x64
#   scripts/smoke-test.sh docker run --rm -i pulse-cli:ci
#   scripts/smoke-test.sh node build/standalone/pulse-cli.cjs
#
# The expected version is EXPECTED_VERSION, else the version in package.json.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command that starts pulse-cli...>" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected="${EXPECTED_VERSION:-$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$root/package.json")}"
engine='http://engine.example:8080/engine-rest'
stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT

fail() {
  local message="smoke test of '$*' failed: $failure"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error::$message" >&2; else echo "$message" >&2; fi
  if [ -s "$stderr_file" ]; then cat "$stderr_file" >&2; fi
  exit 1
}

# expect <label> <pattern> <command...>: the command exits 0 and stdout matches the glob pattern
expect() {
  local label="$1" pattern="$2" output
  shift 2
  echo "--- $label"
  if ! output="$("$@" 2>"$stderr_file")"; then
    failure="$label exited with an error"
    fail "$@"
  fi
  # shellcheck disable=SC2053 # the pattern is a glob on purpose
  if [[ "$output" != $pattern ]]; then
    failure="$label printed: ${output:0:300} (expected: $pattern)"
    fail "$@"
  fi
}

expect '--version' "$expected" "$@" --version
expect '--help' '*Usage: pulse-cli *API groups:*process-instance*' "$@" --help
expect 'commands (catalog)' '\[{"group":*"group":"process-instance"*' "$@" commands
expect 'describe' '*"operationId":"getProcessInstances"*' "$@" describe process-instance list
expect 'guide' '*pulse-cli ping*' "$@" guide
expect 'dry-run' \
  '*"method":"DELETE","url":"http://engine.example:8080/engine-rest/process-instance/abc"*' \
  "$@" process-instance delete abc --dry-run --url "$engine"
expect 'dry-run with the password from stdin' '*"Authorization":"Basic \*\*\*"*' \
  "$@" process-definition list --dry-run --url "$engine" --auth basic --auth-user demo \
  --auth-password-stdin <<<'demo'

# a real request through the HTTP client: nothing listens on port 9, so exit code 8 (network)
echo '--- network error'
code=0
"$@" ping --url http://127.0.0.1:9/engine-rest >/dev/null 2>"$stderr_file" || code=$?
if [ "$code" -ne 8 ] || ! grep -q '"code":"NETWORK"' "$stderr_file"; then
  failure="ping without an engine exited with $code, expected 8 and a NETWORK error"
  fail "$@"
fi

echo "Smoke test passed: $* (version $expected)"
