/**
 * The engine contract's failure of an engine call over the MCP server's SDK wire, for the runtime
 * a dialect's reads run through (`runtimeOf`, engine-runtime.ts): the connector's
 * `EngineRequestError` (engine-error.ts) onto engine-core's `RuntimeError`, the message as the
 * model reads it. An HTTP status reads as the C7 adapter's `ErrorTranslation` reads its wire's.
 * And the caller's cancellation behind a failed read, on the SDK wire and on Camunda 8's.
 */

import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import { HttpFailure } from "@miragon/pulse-http"
import { EngineRequestError, type EngineFailureKind } from "./engine-error.js"

/** The failure of an engine's error answer, as the C7 adapter reads a status. */
function failureOfStatus(status: number): RuntimeFailure {
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  return status < 400 || status === 404 ? "misconfigured" : "engineFailure"
}

/**
 * A call of the kind "connection": the transport's broken connection and a success that is no
 * valid JSON (its `invalid-answer`, which engine-error.ts words "connection" too) share it, so the
 * cause tells them apart. An answer the server cannot read is an unexpected response; every other
 * broken connection never reached an answer and is unreachable.
 */
function failureOfConnection(error: EngineRequestError): RuntimeFailure {
  return error.cause instanceof HttpFailure && error.cause.reason === "invalid-answer"
    ? "unexpectedResponse"
    : "unreachable"
}

/** The failure of every kind without a status or a cause to read. */
const FAILURE_OF_KIND: Readonly<
  Record<Exclude<EngineFailureKind, "http" | "connection">, RuntimeFailure>
> = {
  unreachable: "unreachable",
  tls: "unreachable",
  timeout: "unreachable",
  cancelled: "unreachable",
  "too-large": "unexpectedResponse",
  refused: "misconfigured",
}

function failureOf(error: EngineRequestError): RuntimeFailure {
  if (error.kind === "http") {
    return error.httpStatus === undefined ? "unexpectedResponse" : failureOfStatus(error.httpStatus)
  }
  if (error.kind === "connection") return failureOfConnection(error)
  return FAILURE_OF_KIND[error.kind]
}

/**
 * The `failureOf` of `C7Runtime.over(port, { failureOf })` on the connector's port: an
 * `EngineRequestError` by its kind, its status or its cause, any other error (a route the table
 * lacks, say) as an unexpected response; the message is the error's own.
 */
export function runtimeErrorOf(error: unknown): RuntimeError {
  if (error instanceof EngineRequestError) {
    return new RuntimeError(failureOf(error), error.message, { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new RuntimeError("unexpectedResponse", message, { cause: error })
}

/**
 * The caller's cancellation behind a failed read, on either wire the server reads: the SDK's
 * `EngineRequestError` of kind "cancelled" (Camunda 7, also inside the `RuntimeError` C7Runtime
 * wraps it in), or a `RuntimeError` whose cause is the transport's `HttpFailure` of reason
 * "cancelled" (Camunda 8's wire rejects with the transport's failure as it is). Undefined for any
 * other failure.
 */
export function cancellationOf(error: unknown): Error | undefined {
  const cause = RuntimeError.is(error) ? error.cause : error
  if (cause instanceof EngineRequestError) return cause.kind === "cancelled" ? cause : undefined
  if (!(cause instanceof HttpFailure) || cause.reason !== "cancelled") return undefined
  return RuntimeError.is(error) ? error : cause
}
