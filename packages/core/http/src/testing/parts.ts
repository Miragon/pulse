/**
 * The building blocks of the conformance cases: the connections, requests and engine answers
 * they share. The answers are the error-path goldens' where a case shares a golden's name (the
 * login redirect, CIB seven's bare 401, a servlet container's 404, the 500 that echoes secrets).
 */
import type { CaseAnswer, CaseConnection, CaseCredential, CaseRequest } from "./types.js"

const NONE: CaseCredential = { type: "none" }
export const DEMO: CaseCredential = { type: "basic", username: "demo", password: "demo-secret" }
/** Base64 of `demo:demo-secret`: the Basic value the engine sees and must never be shown. */
export const DEMO_BASIC = "ZGVtbzpkZW1vLXNlY3JldA=="
export const TOKEN: CaseCredential = { type: "bearer", token: "tok-demo-123" }

/** A connection to a loopback engine at /engine-rest, without credentials, 5 s per attempt. */
export const connection = (overrides: Partial<CaseConnection> = {}): CaseConnection => ({
  endpoint: "loopback",
  root: "/engine-rest",
  credential: NONE,
  timeoutMs: 5_000,
  ...overrides,
})

/** A read of one process instance. */
export const READ: CaseRequest = {
  method: "GET",
  path: "/process-instance/{id}",
  values: { id: "pi-1" },
  intent: "read",
}

export const WRITE_BODY = '{"value":1,"type":"Integer"}'

/** A write: one variable of the instance. */
export const WRITE: CaseRequest = {
  method: "PUT",
  path: "/process-instance/{id}/variables/{name}",
  values: { id: "pi-1", name: "amount" },
  intent: "write",
  body: WRITE_BODY,
}

export const QUERY_BODY = '{"businessKey":"B-7"}'

/** A reading POST: the instance query, a POST only because the query has a body. */
export const QUERY: CaseRequest = {
  method: "POST",
  path: "/process-instance",
  intent: "read",
  body: QUERY_BODY,
}

const JSON_TYPE = { "Content-Type": "application/json" }

export const INSTANCE: CaseAnswer = { body: '{"id":"pi-1","ended":false}', headers: JSON_TYPE }

export const NO_CONTENT: CaseAnswer = { status: 204 }

/** A JSON answer. */
export const json = (body: string, status = 200): CaseAnswer => ({
  status,
  body,
  headers: JSON_TYPE,
})

export const LOGIN_PAGE =
  "https://sso.example.com/realms/ops/protocol/openid-connect/auth?client_id=engine&state=4711"

/** What CIB seven's REST auth filter answers without valid credentials: 401 without a body. */
export const UNAUTHORIZED: CaseAnswer = {
  status: 401,
  headers: { "WWW-Authenticate": 'Basic realm="engine"' },
}

/** A servlet container's HTML 404 for a path outside the REST application. */
export const CONTAINER_404: CaseAnswer = {
  status: 404,
  headers: { "Content-Type": "text/html;charset=utf-8" },
  body:
    '<!doctype html><html lang="en"><head><title>HTTP Status 404 – Not Found</title></head>' +
    "<body><h1>HTTP Status 404 – Not Found</h1></body></html>",
}

const STACK_FRAME = "\tat com.example.payment.Gateway.charge(Gateway.java:17)\n"

/** An engine message (over 500 characters, with line breaks) that echoes the cases' secrets. */
const ECHOED_SECRETS =
  "ENGINE-16004 Exception while closing command context: the payment call of order B-7 failed\n" +
  `\tsent Authorization: Basic ${DEMO_BASIC} for user demo, password demo-secret\n` +
  "\tsent Authorization: Bearer tok-demo-123\n" +
  STACK_FRAME.repeat(8) +
  "the end of the engine's message"

export const ECHOES_SECRETS: CaseAnswer = json(
  JSON.stringify({ type: "ProcessEngineException", message: ECHOED_SECRETS }),
  500,
)
