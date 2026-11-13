/**
 * The error-path cases and the engine answers that make each one the same case on every
 * surface: the MCP server's, the CLI's (apps/cli/test/support/error-cases.ts) and Pulse for
 * VS Code's (apps/vscode/test/adapters/c7/goldens/error-cases.ts).
 * Apps share no code, so each keeps its copy; scripts/error-path-goldens.test.mjs holds the
 * three equal below their imports. The VS Code copy may carry no comment (its lint forbids
 * them), so the answers are explained here:
 * - redirectToLogin: a gateway's 302 to a login page, whose query the message must drop;
 * - unauthorized: what CIB seven's REST auth filter answers without valid credentials, 401
 *   without a body;
 * - outsideRestApp: a servlet container in front of `world`, its HTML 404 for a path outside
 *   the REST application;
 * - missingInstance: 404 InvalidRequestException for pi-1, at runtime and in the history;
 * - echoesSecrets: 500 ProcessEngineException whose message (over 500 characters, with line
 *   breaks) echoes the Basic header value, the password and the bearer token of the cases;
 * - withBigLong: `world`, whose variable reads of pi-1 hold a Long beyond 2^53, written as the
 *   engine writes it.
 */
import type { EngineAnswer } from "./fake-engines.js"

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

const LOGIN_PAGE =
  "https://sso.example.com/realms/ops/protocol/openid-connect/auth?client_id=engine&state=4711"

export const redirectToLogin: EngineAnswer = () => ({
  status: 302,
  raw: "",
  headers: { Location: LOGIN_PAGE },
})

export const unauthorized: EngineAnswer = () => ({
  status: 401,
  raw: "",
  headers: { "WWW-Authenticate": 'Basic realm="engine"' },
})

const CONTAINER_404 =
  '<!doctype html><html lang="en"><head><title>HTTP Status 404 – Not Found</title></head>' +
  "<body><h1>HTTP Status 404 – Not Found</h1></body></html>"

export const outsideRestApp =
  (world: EngineAnswer): EngineAnswer =>
  (request) =>
    request.target.startsWith("/engine-rest/")
      ? world(request)
      : { status: 404, raw: CONTAINER_404, contentType: "text/html;charset=utf-8" }

export const missingInstance: EngineAnswer = (request) => ({
  status: 404,
  body: {
    type: "InvalidRequestException",
    message: request.target.includes("/history/")
      ? "Historic process instance with id pi-1 does not exist"
      : "Process instance with id pi-1 does not exist",
  },
})

const STACK_FRAME = "\tat com.example.payment.Gateway.charge(Gateway.java:17)\n"

const ECHOED_SECRETS =
  "ENGINE-16004 Exception while closing command context: the payment call of order B-7 failed\n" +
  "\tsent Authorization: Basic ZGVtbzpkZW1vLXNlY3JldA== for user demo, password demo-secret\n" +
  "\tsent Authorization: Bearer tok-demo-123\n" +
  STACK_FRAME.repeat(8) +
  "the end of the engine's message"

export const echoesSecrets: EngineAnswer = () => ({
  status: 500,
  body: { type: "ProcessEngineException", message: ECHOED_SECRETS },
})

const BIG_LONG = "9223372036854775807"

const BIG_LONG_READS: Readonly<Partial<Record<string, string>>> = {
  "/engine-rest/process-instance/pi-1/variables": `{"big":{"type":"Long","value":${BIG_LONG},"valueInfo":{}}}`,
  "/engine-rest/variable-instance": `[{"id":"v-1","name":"big","type":"Long","value":${BIG_LONG},"valueInfo":{},"processInstanceId":"pi-1","activityInstanceId":"pi-1","executionId":"pi-1"}]`,
}

export const withBigLong =
  (world: EngineAnswer): EngineAnswer =>
  (request) => {
    const raw = BIG_LONG_READS[new URL(request.target, "http://engine").pathname]
    return raw === undefined ? world(request) : { raw, contentType: "application/json" }
  }
