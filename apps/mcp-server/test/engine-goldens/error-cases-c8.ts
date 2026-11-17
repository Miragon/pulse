/**
 * The error-path cases of the server's Camunda 8 goldens (error-paths-c8.golden.test.ts) and the
 * cluster answers that make them: a copy of the C8 adapter's case file
 * (packages/connectors/c8/c8-adapter/test/goldens/error-cases.ts) below this header, its case list,
 * the cases of Camunda 8 alone and every answer. Apps share no code, so each surface keeps its copy,
 * and scripts/error-path-goldens.test.mjs holds the two equal, so a change to one changes the other
 * in the same commit. The answers are explained in the C8 adapter's goldens README
 * (packages/connectors/c8/c8-adapter/test/__golden__/error-paths/README.md).
 */

import { clusterWorld, problemOf, topologyOf } from "./c8-cluster-world.js"
import type { EngineAnswer, EngineReply, SentRequest } from "./fake-c8-cluster.js"

export const ERROR_PATH_CASES = [
  "redirect",
  "unauthorized-none",
  "unauthorized-basic",
  "unauthorized-bearer",
  "unauthorized-passthrough",
  "wrong-rest-root",
  "missing-resource",
  "engine-text-echoes-secret-basic",
  "engine-text-echoes-secret-bearer",
  "deadline-exceeded",
  "unreachable",
  "tls-failure",
  "dns-failure",
  "too-large-response",
  "basic-password-euro",
  "path-value-dot",
  "double-slash-root",
  "token-line-break-inside",
  "token-line-break-trailing",
  "integer-beyond-2-53",
] as const

export type ErrorPathCase = (typeof ERROR_PATH_CASES)[number]

export const CAMUNDA_8_CASES = [
  "token-endpoint-refusal",
  "token-endpoint-rate-limit",
  "unauthorized-renewed",
  "unauthorized-after-the-one-retry",
  "version-below-the-floor",
  "url-of-operate",
  "no-secondary-storage",
] as const

export type Camunda8Case = (typeof CAMUNDA_8_CASES)[number]

export const TOKEN_PATH = "/realms/pulse/protocol/openid-connect/token"

const LOGIN_PAGE =
  "https://sso.example.com/realms/ops/protocol/openid-connect/auth?client_id=camunda&state=4711"

export const redirectToLogin: EngineAnswer = () => ({
  status: 302,
  raw: "",
  headers: { Location: LOGIN_PAGE },
})

export const unauthorizedWithoutLogin: EngineAnswer = (request) =>
  problemOf(
    401,
    "Unauthorized",
    "An Authentication object was not found in the SecurityContext",
    request.target,
  )

export const unauthorizedBasic: EngineAnswer = (request) => ({
  ...problemOf(401, "Unauthorized", "Unauthorized", request.target),
  headers: { "WWW-Authenticate": 'Basic realm="Realm"' },
})

const BEARER_REFUSED: EngineReply = {
  status: 401,
  raw: "",
  headers: {
    "WWW-Authenticate":
      'Bearer error="invalid_token", error_description="An error occurred while attempting to decode the Jwt: Malformed token", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"',
  },
}

export const outsideV2: EngineAnswer = (request) =>
  request.target.startsWith("/v2/")
    ? clusterWorld(request)
    : problemOf(404, "Not Found", "No message available", request.target)

export const operateInsteadOfV2: EngineAnswer = (request) =>
  request.target.startsWith("/v2/")
    ? clusterWorld(request)
    : problemOf(404, "Not Found", `No endpoint GET ${request.target}.`, request.target)

export const missingInstance: EngineAnswer = (request) => {
  const key = /^\/v2\/process-instances\/(\d+)$/.exec(request.target)?.[1]
  return key === undefined
    ? clusterWorld(request)
    : problemOf(404, "NOT_FOUND", `Process Instance with key '${key}' not found`, request.target)
}

const STACK_FRAME = "\tat io.camunda.exporter.Payments.charge(Payments.java:17)\n"

const ECHOED_SECRETS =
  "Failed to execute the request: the payment call of order B-7 failed\n" +
  "\tsent Authorization: Basic ZGVtbzpkZW1vLXNlY3JldA== for user demo, password demo-secret\n" +
  "\tsent Authorization: Bearer tok-demo-123\n" +
  "\tasked for it with client_id=pulse-reader&client_secret=reader-secret\n" +
  STACK_FRAME.repeat(8) +
  "the end of the cluster's message"

export const echoesSecrets: EngineAnswer = (request) =>
  request.target === TOKEN_PATH
    ? issuing(["tok-demo-123"])(request)
    : problemOf(500, "INTERNAL_SERVER_ERROR", ECHOED_SECRETS, request.target)

function tokenAnswer(token: string): EngineReply {
  return {
    body: {
      access_token: token,
      expires_in: 300,
      refresh_expires_in: 0,
      token_type: "Bearer",
      "not-before-policy": 0,
      scope: "profile email",
    },
  }
}

export function issuing(tokens: readonly string[], cluster: EngineAnswer = clusterWorld) {
  let issued = 0
  return (request: SentRequest): EngineReply => {
    if (request.target !== TOKEN_PATH) {
      return cluster(request)
    }
    const token = tokens[Math.min(issued, tokens.length - 1)] ?? ""
    issued += 1
    return tokenAnswer(token)
  }
}

export const acceptingOnly =
  (token: string): EngineAnswer =>
  (request) =>
    request.authorization === `Bearer ${token}` ? clusterWorld(request) : BEARER_REFUSED

export const refusingEveryToken: EngineAnswer = () => BEARER_REFUSED

export const refusingTheClient: EngineAnswer = (request) =>
  request.target === TOKEN_PATH
    ? {
        status: 401,
        body: {
          error: "unauthorized_client",
          error_description: "Invalid client or Invalid client credentials",
        },
      }
    : clusterWorld(request)

export function rateLimitedOnce(): EngineAnswer {
  const tokens = issuing(["tok-after-the-wait"])
  let limited = false
  return (request) => {
    if (request.target !== TOKEN_PATH || limited) {
      return tokens(request)
    }
    limited = true
    return { status: 429, raw: "", headers: { "Retry-After": "30" } }
  }
}

export const belowTheFloor: EngineAnswer = (request) =>
  request.target === "/v2/topology" ? topologyOf("8.8.12") : clusterWorld(request)

const NO_STORAGE =
  "This endpoint requires a secondary storage, but none is set. Secondary storage can be configured using the 'camunda.data.secondary-storage.type' property."

export const withoutSecondaryStorage: EngineAnswer = (request) =>
  request.target === "/v2/topology"
    ? clusterWorld(request)
    : problemOf(403, "FORBIDDEN", NO_STORAGE, request.target)
