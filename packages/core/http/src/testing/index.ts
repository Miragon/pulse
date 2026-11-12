/**
 * @miragon/pulse-http/testing: what a surface tests its wiring of the transport with, as data and
 * plain functions (no test framework, no Node built-in).
 * - TRANSPORT_CASES: the conformance cases every wiring must pass. A wiring (this package's own
 *   over Node's fetch, the MCP server's SDK client, the CLI's commands, Pulse for VS Code's
 *   adapters) runs each case its surface can express (`casesFor`) against a recording engine on
 *   loopback, one per case, maps what it got onto an `Observed` and asserts
 *   `caseFindings(kase, observed, seen)` is empty. Where a case is also one of the error-path
 *   goldens of the surfaces, it carries that golden's name.
 * - recordingFetch: a fake fetch without sockets for the unit tests, which records each request
 *   and plays a script.
 */
export { TRANSPORT_CASES } from "./cases.js"
export { CASE_CAPABILITIES, type CaseCapability, casesFor, requirementsOf } from "./capabilities.js"
export { caseFindings, credentialOfCase, pathOfCase } from "./findings.js"
export {
  type Recorded,
  type RecordingFetch,
  recordingFetch,
  type Scripted,
} from "./recording-fetch.js"
export type {
  CaseAnswer,
  CaseConnection,
  CaseCredential,
  CaseExpectation,
  CaseRequest,
  Endpoint,
  Observed,
  Seen,
  TransportCase,
} from "./types.js"
