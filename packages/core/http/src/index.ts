/**
 * @miragon/pulse-http: one HTTP transport for the Pulse MCP server, the Pulse CLI and Pulse for
 * VS Code. A connection becomes an `Http` over the `fetch` the caller hands in: a deadline to the
 * last byte of the answer, never a redirect, a size cap, one credential seam with exactly one
 * second attempt after a 401 when the credential renewed, failure reasons as data, lossless JSON
 * and the request's secrets masked in every text the server sent back. No runtime dependency, no
 * Node built-in: building requests, the dialect's reading of an answer and every word a person
 * reads stay with each surface.
 */

export type {
  AsFetchOptions,
  Connection,
  Http,
  HttpAnswer,
  HttpRequest,
  Intent,
  Platform,
  TraceEvent,
} from "./types.js"
export { createHttp } from "./http.js"
export { MAX_ANSWER_BYTES } from "./body.js"
export {
  type Authorization,
  basicCredential,
  bearerCredential,
  bearerToken,
  callerToken,
  type Credential,
  CredentialError,
  type CredentialProblem,
  noCredential,
  staticToken,
  type TokenSource,
} from "./credential.js"
export {
  FAILURE_REASONS,
  type FailureDetails,
  type FailureReason,
  HttpFailure,
  type Problem,
} from "./failure.js"
export { INTEGER_MODES, type IntegerMode, parseJson, stringifyJson } from "./json.js"
export { clipText, MASK, maskJsonText, maskSecrets, secretForms } from "./mask.js"
export { decodeText, mediaTypeOf, problemOf } from "./problem.js"
export { STATUS_TEXT, statusTextOf } from "./status.js"
export {
  encodePathValue,
  joinUrl,
  type PathValueProblem,
  PathValueError,
  pathValueProblem,
  type Query,
  type QueryValue,
  requestUrlProblem,
  type RequestUrlProblem,
  rootOf,
} from "./url.js"
