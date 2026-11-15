/**
 * The engine contract's failure of an engine call over the MCP server's SDK wire, for the engine
 * suite that runs c7-core's `C7Runtime` over it (`c7-runtime.engine.test.ts`): the connector's
 * `EngineRequestError` (engine-error.ts) onto engine-core's `RuntimeError`, the message as the
 * model reads it. An HTTP status reads as the C7 adapter's `ErrorTranslation` reads its wire's.
 * Test support until the connector's src runs the runtime (phase 4's decision 3), which then moves
 * it beside engine-error.ts.
 */

import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import { HttpFailure } from "@miragon/pulse-http"
import { EngineRequestError, type EngineFailureKind } from "../engine/engine-error.js"

/** The failure of an engine's error answer, as the C7 adapter reads a status. */
function failureOfStatus(status: number): RuntimeFailure {
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  return status < 400 || status === 404 ? "misconfigured" : "engineFailure"
}

/**
 * A call of the kind "connection". The kind is ambiguous on this wire, which phase 6 decides: the
 * transport's broken connection and a success that is no valid JSON (the transport's
 * `invalid-answer`, worded "connection" by engine-error.ts) share it, and only the cause tells
 * them apart. The first never reached an answer, the second got one it cannot read.
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
