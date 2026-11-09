/**
 * The conformance cases of the request and the answer: the root, the path values, the read-only
 * connection, error statuses and what their bodies state, integers beyond 2^53.
 */
import {
  connection,
  CONTAINER_404,
  INSTANCE,
  json,
  NO_CONTENT,
  QUERY,
  QUERY_BODY,
  READ,
  WRITE,
} from "./parts.js"
import type { CaseAnswer, CaseRequest, TransportCase } from "./types.js"

const withId = (id: string): CaseRequest => ({ ...READ, values: { id } })
/** The write with `id` inside its path, before the variable's name. */
const writeWithId = (id: string): CaseRequest => ({ ...WRITE, values: { id, name: "amount" } })
const LOGIN_FORM: CaseAnswer = {
  headers: { "Content-Type": "text/html" },
  body: "<html><form>Sign in</form></html>",
}
const READ_ONLY = connection({ readOnly: true })

export const REQUEST_CASES: readonly TransportCase[] = [
  {
    name: "wrong-rest-root",
    about: "a root without the REST path reaches a servlet container: a 404 that states nothing",
    connection: connection({ root: "" }),
    request: READ,
    answers: [CONTAINER_404],
    expect: { outcome: "status", status: 404, sent: 1, targets: ["/process-instance/pi-1"] },
  },
  {
    name: "missing-resource",
    about: "a 404 states the engine's exception type and message",
    connection: connection(),
    request: READ,
    answers: [
      json(
        '{"type":"InvalidRequestException","message":"Process instance with id pi-1 does not exist"}',
        404,
      ),
    ],
    expect: {
      outcome: "status",
      status: 404,
      mayHaveApplied: false,
      sent: 1,
      contains: ["InvalidRequestException", "Process instance with id pi-1 does not exist"],
    },
  },
  {
    name: "bad-request-as-text",
    about: "a plain text error body is its message",
    connection: connection(),
    request: WRITE,
    answers: [
      {
        status: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Cannot deserialize value of type `java.lang.Integer`",
      },
    ],
    expect: {
      outcome: "status",
      status: 400,
      mayHaveApplied: false,
      sent: 1,
      contains: ["Cannot deserialize value of type"],
    },
  },
  {
    name: "path-value-dot",
    about: "a path value . is refused before sending: the parser would read the list instead",
    connection: connection(),
    request: withId("."),
    answers: [INSTANCE],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "path-value-dot-dot",
    about: "a path value .. is refused before sending: the parser would climb to the root",
    connection: connection(),
    request: withId(".."),
    answers: [INSTANCE],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "path-value-empty",
    about: "an empty path value is refused before sending",
    connection: connection(),
    request: withId(""),
    answers: [INSTANCE],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "path-value-dot-inside-a-write",
    about: "a path value . inside a write's path is refused: the parser would write elsewhere",
    connection: connection(),
    request: writeWithId("."),
    answers: [NO_CONTENT],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "path-value-dot-dot-inside-a-write",
    about: "a path value .. inside a write's path is refused: the parser would climb out of it",
    connection: connection(),
    request: writeWithId(".."),
    answers: [NO_CONTENT],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "path-value-empty-inside-a-write",
    about: "an empty path value inside a write's path is refused before sending",
    connection: connection(),
    request: writeWithId(""),
    answers: [NO_CONTENT],
    expect: { outcome: "invalid-request", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "double-slash-root",
    about: "the root's trailing slashes are trimmed, so the request has a single one",
    connection: connection({ root: "/engine-rest//" }),
    request: READ,
    answers: [INSTANCE],
    expect: {
      outcome: "answered",
      status: 200,
      sent: 1,
      targets: ["/engine-rest/process-instance/pi-1"],
    },
  },
  {
    name: "integer-beyond-2-53",
    about: "a Long beyond 2^53 keeps its digits",
    connection: connection(),
    request: { ...READ, path: "/process-instance/{id}/variables", expects: "json" },
    answers: [json('{"big":{"type":"Long","value":9223372036854775807,"valueInfo":{}}}')],
    expect: { outcome: "answered", status: 200, sent: 1, contains: ["9223372036854775807"] },
  },
  {
    name: "invalid-answer",
    about: "a 200 that is no JSON (a gateway's login page) fails a read that expects JSON",
    connection: connection(),
    request: { ...READ, expects: "json" },
    answers: [LOGIN_FORM],
    expect: { outcome: "invalid-answer", mayHaveApplied: false, sent: 1 },
  },
  {
    name: "invalid-answer-write",
    about: "a write whose 200 is no JSON reached the engine, so it may have been applied",
    connection: connection(),
    request: { ...WRITE, method: "POST", expects: "json" },
    answers: [LOGIN_FORM],
    expect: { outcome: "invalid-answer", mayHaveApplied: true, sent: 1 },
  },
  {
    name: "read-only-refuses-a-write",
    about: "a read-only connection refuses a write before sending",
    connection: READ_ONLY,
    request: WRITE,
    answers: [NO_CONTENT],
    expect: { outcome: "refused-write", mayHaveApplied: false, sent: 0 },
  },
  {
    name: "read-only-sends-a-reading-post",
    about: "a read-only connection sends a POST the caller marks as a read",
    connection: READ_ONLY,
    request: QUERY,
    answers: [json('[{"id":"pi-1"}]')],
    expect: { outcome: "answered", status: 200, sent: 1, bodies: [QUERY_BODY] },
  },
  {
    name: "no-content",
    about: "a 204 is an answer without a body",
    connection: connection(),
    request: {
      method: "DELETE",
      path: "/process-instance/{id}",
      values: { id: "pi-1" },
      intent: "write",
    },
    answers: [NO_CONTENT],
    expect: { outcome: "answered", status: 204, sent: 1 },
  },
]
