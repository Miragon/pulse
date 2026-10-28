/**
 * Shared fixtures of the HTTP error tests (src/http/errors*.test.ts): the request, an engine
 * response and the hints the errors carry, word for word.
 */

import type { HttpResponse } from "../../src/http/types.js"

export const REQUEST = { method: "GET", url: "http://localhost:8080/engine-rest/task/1" }

export function response(
  status: number,
  body: string,
  contentType = "application/json",
  statusText = "",
): HttpResponse {
  return {
    status,
    statusText,
    contentType,
    headers: { "content-type": contentType },
    body: new TextEncoder().encode(body),
  }
}

export const HINTS = {
  401: "The engine requires authentication and pulse-cli sent no credentials. Use Basic auth: --auth basic --auth-user <name> with the password piped into --auth-password-stdin, PULSE_CLI_USERNAME and PULSE_CLI_PASSWORD, or a profile: `pulse-cli config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`. A token from elsewhere (SSO tooling, a CI secret): --auth bearer with PULSE_CLI_TOKEN or --auth-token-stdin, or PULSE_CLI_TOKEN_COMMAND with a command that prints one.",
  rejected:
    "The engine rejected the credentials of the Authorization header (from -H, PULSE_CLI_HEADERS or the profile headers; `pulse-cli config show` shows which). Check user and password or the token.",
  queryParam:
    "A query parameter has a value the engine cannot read, e.g. a number beyond the int32 range or a malformed date; the engine reports this as 404. Check the option values.",
  403: "The user is authenticated but lacks the authorization for this operation.",
  endpoint:
    "The endpoint does not exist. Check that the URL points to the REST API root, e.g. http://localhost:8080/engine-rest, and the engine name (--engine).",
  resource: "Check the id or key. List existing resources with the `list` command of the group.",
  server:
    "The engine could not process the request; the engine message says why. Camunda 7 engines also report rule violations (task already claimed, dependent instances, ...) as 500, so retrying unchanged rarely helps.",
  client:
    "The engine rejected the request. Check parameters and body with `pulse-cli describe <group> <command>`.",
}
