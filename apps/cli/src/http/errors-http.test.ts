/**
 * httpError (errors.ts): message, details, codes, exit codes and hints of the HTTP errors; the
 * hints that name the command that sent the request are in errors.test.ts.
 */

import { describe, expect, it } from "vitest"
import { HINTS, REQUEST, response } from "../../test/support/http-errors.js"
import { httpError } from "./errors.js"

describe("httpError", () => {
  it("builds the message and details from the engine error", () => {
    const body = JSON.stringify({
      type: "InvalidRequestException",
      message: "Task with id 1 does not exist",
      code: 7,
      extra: true,
    })
    const error = httpError(response(404, body, "application/json", "Not Found"), REQUEST)
    expect(error.code).toBe("NOT_FOUND")
    expect(error.exitCode).toBe(5)
    expect(error.message).toBe("HTTP 404 Not Found: Task with id 1 does not exist")
    expect(error.details).toEqual({
      status: 404,
      request: REQUEST,
      hint: HINTS.resource,
      engineType: "InvalidRequestException",
      engineMessage: "Task with id 1 does not exist",
      engineCode: 7,
      data: { extra: true },
    })
  })

  it("falls back to the status line without an engine message", () => {
    const error = httpError(
      response(500, "<p>boom</p>", "text/html", "Internal Server Error"),
      REQUEST,
    )
    expect(error.message).toBe("HTTP 500 Internal Server Error")
    expect(error.details).toEqual({ status: 500, request: REQUEST, hint: HINTS.server })
  })

  it("shows the text of a plain text error body", () => {
    const body = "Cannot deserialize value of type `java.lang.String` from Array value"
    const error = httpError(response(400, body, "text/plain", "Bad Request"), REQUEST)
    expect(error.message).toBe(`HTTP 400 Bad Request: ${body}`)
    expect(error.details.engineMessage).toBe(body)
    expect(error.details).not.toHaveProperty("engineType")
  })

  it("says that credentials were rejected when an Authorization header was sent", () => {
    const sent = { ...REQUEST, headers: { authorization: "Basic ZGVtbzp3cm9uZw==" } }
    const error = httpError(response(401, ""), sent)
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.details.hint).toBe(HINTS.rejected)
    expect(error.details.request).toEqual(REQUEST)
    const other = { ...REQUEST, headers: { "X-Tenant": "a" } }
    expect(httpError(response(401, ""), other).details.hint).toBe(HINTS[401])
  })

  it("names the user and the source of rejected Basic auth credentials", () => {
    const basic = { ...REQUEST, principal: { user: "demo", source: "env" } }
    const error = httpError(response(401, ""), basic)
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.exitCode).toBe(4)
    expect(error.details.hint).toBe(
      "The engine rejected the credentials of user demo (source: env). Check the username and the password; `pulse-cli config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying.",
    )
    expect(error.details.request).toEqual(REQUEST)
    expect(HINTS[401]).toContain("pulse-cli sent no credentials")
    expect(HINTS[401]).not.toContain("issues/1")
  })

  it("says why no credentials were sent when Basic auth is off", () => {
    const off = { ...REQUEST, authOff: "Basic auth is switched off by PULSE_CLI_AUTH=none" }
    const error = httpError(response(401, ""), off)
    expect(error.details.hint).toBe(
      HINTS[401].replace(
        "pulse-cli sent no credentials.",
        "pulse-cli sent no credentials: Basic auth is switched off by PULSE_CLI_AUTH=none.",
      ),
    )
    expect(error.details.hint).not.toBe(HINTS[401])
    // an Authorization header was sent after all: the credentials were rejected
    const sent = { ...off, headers: { Authorization: "Bearer t" } }
    expect(httpError(response(401, ""), sent).details.hint).toBe(HINTS.rejected)
    expect(httpError(response(403, ""), off).details.hint).toBe(HINTS[403])
  })

  it("lets the provider's hint win for 401 and 403, not for other statuses", () => {
    const oauth = {
      ...REQUEST,
      rejectedHint: "OAuth hint",
      principal: { user: "alice", source: "s" },
    }
    expect(httpError(response(401, ""), oauth).details.hint).toBe("OAuth hint")
    expect(httpError(response(403, ""), oauth).details.hint).toBe("OAuth hint")
    expect(httpError(response(500, ""), oauth).details.hint).toBe(HINTS.server)
    expect(httpError(response(401, ""), { ...REQUEST, rejectedHint: undefined }).details.hint).toBe(
      HINTS[401],
    )
  })

  it("appends the provider's note to the 401 and 403 hints only", () => {
    const note = "A bearer token is set (from PULSE_CLI_TOKEN) but not used."
    const basic = { ...REQUEST, principal: { user: "demo", source: "flag" }, authNote: note }
    expect(httpError(response(401, ""), basic).details.hint).toMatch(
      /^The engine rejected the credentials of user demo \(source: flag\)\. .* A bearer token is set \(from PULSE_CLI_TOKEN\) but not used\.$/,
    )
    expect(httpError(response(403, ""), basic).details.hint).toBe(`${HINTS[403]} ${note}`)
    const oauth = { ...REQUEST, rejectedHint: "OAuth hint", authNote: note }
    expect(httpError(response(401, ""), oauth).details.hint).toBe(`OAuth hint ${note}`)
    expect(httpError(response(500, ""), oauth).details.hint).toBe(HINTS.server)
  })

  it("keeps the 403 hint with Basic auth credentials", () => {
    const basic = { ...REQUEST, principal: { user: "demo", source: "flag" } }
    expect(httpError(response(403, ""), basic).details.hint).toBe(HINTS[403])
  })

  it("reports a 404 QueryParamException as a rejected request, not a missing resource", () => {
    const body = '{"type":"QueryParamException","message":"HTTP 404 Not Found"}'
    const error = httpError(response(404, body, "application/json", "Not Found"), REQUEST)
    expect(error.code).toBe("HTTP_CLIENT_ERROR")
    expect(error.exitCode).toBe(6)
    expect(error.details.hint).toBe(HINTS.queryParam)
  })

  it("omits an empty status text", () => {
    expect(httpError(response(502, "", "text/plain"), REQUEST).message).toBe("HTTP 502")
  })

  it("does not repeat an engine message that equals the status line", () => {
    const body = '{"type":"NotFoundException","message":"HTTP 404 Not Found"}'
    const error = httpError(response(404, body, "application/json", "Not Found"), REQUEST)
    expect(error.message).toBe("HTTP 404 Not Found")
    expect(error.details.engineMessage).toBe("HTTP 404 Not Found")
  })

  it("keeps an engine message that only starts like the status line", () => {
    const body = '{"type":"T","message":"HTTP 404 Not Found: x"}'
    const error = httpError(response(404, body, "application/json", "Not Found"), REQUEST)
    expect(error.message).toBe("HTTP 404 Not Found: HTTP 404 Not Found: x")
  })

  it("ignores an empty engine message in the summary", () => {
    const error = httpError(
      response(400, '{"type":"T","message":""}', "application/json", "Bad"),
      REQUEST,
    )
    expect(error.message).toBe("HTTP 400 Bad")
    expect(error.details.engineMessage).toBe("")
  })

  it.each([
    { status: 401, type: "text/html", body: "", code: "UNAUTHORIZED", exit: 4, hint: HINTS[401] },
    {
      status: 403,
      type: "application/json",
      body: '{"message":"no"}',
      code: "FORBIDDEN",
      exit: 4,
      hint: HINTS[403],
    },
    {
      status: 404,
      type: "text/html",
      body: "<h1>Not Found</h1>",
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: "application/json",
      body: "[]",
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: "application/json",
      body: '{"type":"T"}',
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.resource,
    },
    {
      status: 404,
      type: "application/json",
      body: '{"type":"InvalidRequestException","message":"Task with id 1 does not exist"}',
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.resource,
    },
    {
      status: 404,
      type: "application/json",
      body: '{"type":"NotFoundException","message":"HTTP 404 Not Found"}',
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: "application/json",
      body: '{"timestamp":"2024-05-01T10:00:00.000+00:00","status":404,"error":"Not Found","path":"/x"}',
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 404,
      type: "application/json",
      body: '{"message":"gone"}',
      code: "NOT_FOUND",
      exit: 5,
      hint: HINTS.endpoint,
    },
    {
      status: 400,
      type: "application/json",
      body: '{"message":"bad"}',
      code: "HTTP_CLIENT_ERROR",
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 409,
      type: "text/plain",
      body: "",
      code: "HTTP_CLIENT_ERROR",
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 499,
      type: "text/plain",
      body: "",
      code: "HTTP_CLIENT_ERROR",
      exit: 6,
      hint: HINTS.client,
    },
    {
      status: 500,
      type: "application/json",
      body: '{"message":"x"}',
      code: "HTTP_SERVER_ERROR",
      exit: 7,
      hint: HINTS.server,
    },
    {
      status: 503,
      type: "text/plain",
      body: "",
      code: "HTTP_SERVER_ERROR",
      exit: 7,
      hint: HINTS.server,
    },
  ])(
    "status $status ($type $body) → $code, exit $exit",
    ({ status, type, body, code, exit, hint }) => {
      const error = httpError(response(status, body, type), REQUEST)
      expect(error.code).toBe(code)
      expect(error.exitCode).toBe(exit)
      expect(error.details.hint).toBe(hint)
      expect(error.details.status).toBe(status)
      expect(error.details.request).toEqual(REQUEST)
    },
  )
})
