import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { HINTS, REQUEST, response } from "../../test/support/http-errors.js"
import { errorCodeForStatus, httpError, parseEngineError, redirectError } from "./errors.js"
import type { HttpResponse } from "./types.js"

describe("errorCodeForStatus", () => {
  it.each([
    [399, "HTTP_CLIENT_ERROR"],
    [400, "HTTP_CLIENT_ERROR"],
    [401, "UNAUTHORIZED"],
    [402, "HTTP_CLIENT_ERROR"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [405, "HTTP_CLIENT_ERROR"],
    [499, "HTTP_CLIENT_ERROR"],
    [500, "HTTP_SERVER_ERROR"],
    [501, "HTTP_SERVER_ERROR"],
    [503, "HTTP_SERVER_ERROR"],
  ])("maps %i to %s", (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code)
  })

  it("maps every 5xx status to HTTP_SERVER_ERROR", () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(errorCodeForStatus(status)).toBe("HTTP_SERVER_ERROR")
      }),
    )
  })
})

describe("parseEngineError", () => {
  it("reads type, message, code and keeps the remaining properties as data", () => {
    const body = JSON.stringify({
      type: "AuthorizationException",
      message: "denied",
      code: 0,
      userId: "demo",
      missingAuthorizations: [],
    })
    expect(parseEngineError(response(403, body))).toEqual({
      type: "AuthorizationException",
      message: "denied",
      code: 0,
      data: { userId: "demo", missingAuthorizations: [] },
    })
  })

  it("omits data when there are no extra properties", () => {
    const parsed = parseEngineError(response(400, '{"type":"T","message":"m"}'))
    expect(parsed).toEqual({ type: "T", message: "m" })
    expect(parsed).not.toHaveProperty("data")
    expect(parsed).not.toHaveProperty("code")
  })

  it("drops properties with unexpected types", () => {
    expect(parseEngineError(response(400, '{"type":1,"message":false,"code":"7"}'))).toEqual({})
  })

  it.each(["application/problem+json; charset=utf-8", "Application/JSON", "APPLICATION/JSON"])(
    "accepts the JSON content type %s",
    (contentType) => {
      expect(parseEngineError(response(400, '{"message":"m"}', contentType))).toEqual({
        message: "m",
      })
    },
  )

  it("reads a plain text body as the message, shortened to 500 characters", () => {
    const jackson =
      "Cannot deserialize value of type `java.lang.String` from Array value (token `JsonToken.START_ARRAY`)"
    expect(parseEngineError(response(400, `${jackson}\n`, "text/plain; charset=UTF-8"))).toEqual({
      message: jackson,
    })
    const long = parseEngineError(response(400, "x".repeat(600), "text/plain"))
    expect(long?.message).toBe(`${"x".repeat(500)}…`)
    expect(parseEngineError(response(400, " \n", "text/plain"))).toBeUndefined()
  })

  it.each([
    ["an HTML page", "<html><body>Login</body></html>", "text/html; charset=utf-8"],
    ["a binary content type", '{"message":"m"}', "application/octet-stream"],
    ["an empty content type", '{"message":"m"}', ""],
    ["invalid JSON", "<html>oops</html>", "application/json"],
    ["an empty body", "", "application/json"],
    ["a JSON array", '[{"message":"m"}]', "application/json"],
    ["JSON null", "null", "application/json"],
    ["a JSON string", '"m"', "application/json"],
    ["a JSON number", "42", "application/json"],
  ])("returns undefined for %s", (_name, body, contentType) => {
    expect(parseEngineError(response(500, body, contentType))).toBeUndefined()
  })
})

describe("httpError", () => {
  describe("with the command that sent the request", () => {
    const LISTED = { command: "process-instance get", listCommand: "process-instance list" }
    const UNLISTED = { command: "message correlate" }
    const missing =
      '{"type":"InvalidRequestException","message":"Process instance x does not exist"}'

    it("names the list command of the group for a missing resource", () => {
      expect(httpError(response(404, missing), REQUEST, LISTED).details.hint).toBe(
        "Check the id or key. List the existing ones with `operate process-instance list`.",
      )
    })

    it("points to describe for a missing resource of a group without list command", () => {
      expect(httpError(response(404, missing), REQUEST, UNLISTED).details.hint).toBe(
        "Check the id or key; `operate describe message correlate` explains the arguments.",
      )
    })

    it.each([
      [400, "No process engine available"],
      [404, "Process engine no-such-engine not available"],
    ])("points to ping when the named process engine does not exist (%i)", (status, message) => {
      const body = JSON.stringify({ type: "InvalidRequestException", message })
      const hint =
        "The process engine named by --engine (or OPERATE_ENGINE, or the profile setting engine) does not exist. Run `operate ping` to list the engines of the REST API."
      expect(httpError(response(status, body), REQUEST, LISTED).details.hint).toBe(hint)
      expect(httpError(response(status, body), REQUEST).details.hint).toBe(hint)
    })

    it.each([
      [500, "No process engine available", HINTS.server],
      [400, "No process engine available.", HINTS.client],
      [404, "Process engine x is not available", "Check the id or key."],
      [404, "Process instance x not available", "Check the id or key."],
      [400, "Cannot start: No process engine available", HINTS.client],
    ])('keeps the status hint for %i "%s"', (status, message, start) => {
      const body = JSON.stringify({ type: "InvalidRequestException", message })
      const hint = httpError(response(status, body), REQUEST).details.hint
      expect(hint?.startsWith(start)).toBe(true)
    })

    it("names the describe command for other client errors", () => {
      expect(httpError(response(400, '{"message":"bad"}'), REQUEST, LISTED).details.hint).toBe(
        "The engine rejected the request. Check parameters and body with `operate describe process-instance get`.",
      )
    })

    it.each([
      [404, '{"type":"NotFoundException","message":"HTTP 404 Not Found"}', HINTS.endpoint],
      [401, "", HINTS[401]],
      [403, "", HINTS[403]],
      [500, '{"message":"x"}', HINTS.server],
    ])("keeps the generic hint for status %i", (status, body, hint) => {
      expect(httpError(response(status, body), REQUEST, LISTED).details.hint).toBe(hint)
    })
  })
})

describe("redirectError", () => {
  const redirect = (status: number, location?: string): HttpResponse => ({
    status,
    statusText: "Found",
    contentType: "text/html",
    headers: location === undefined ? {} : { Location: location },
    body: new Uint8Array(),
  })

  it("names the target without query and fragment, as configuration error", () => {
    const error = redirectError(redirect(302, "/login?next=/x&token=SECRET#f"), REQUEST)
    expect(error.code).toBe("HTTP_REDIRECT")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe("HTTP 302 Found: redirect to http://localhost:8080/login")
    expect(error.details).toMatchObject({ status: 302, request: REQUEST })
    expect(error.details.hint).toContain("operate does not follow redirects")
  })

  it("points to operate auth status for OAuth", () => {
    const oauth = redirectError(redirect(302, "/login"), {
      ...REQUEST,
      loginStatusCommand: "operate auth status --profile p",
    })
    expect(oauth.details.hint).toMatch(
      /expired\. `operate auth status --profile p` shows whether the OAuth login is usable\.$/,
    )
    expect(redirectError(redirect(302), REQUEST).details.hint).not.toContain("auth status")
  })

  it("works without or with an unusable Location", () => {
    expect(redirectError(redirect(307), REQUEST).message).toBe("HTTP 307 Found: redirect")
    expect(redirectError(redirect(301, "http://[::1"), REQUEST).message).toBe(
      "HTTP 301 Found: redirect",
    )
    const absolute = redirectError(redirect(308, "https://other.example/engine-rest/"), REQUEST)
    expect(absolute.message).toBe("HTTP 308 Found: redirect to https://other.example/engine-rest/")
  })
})

describe("job execute hints", () => {
  const EXECUTE = { command: "job execute", listCommand: "job list" }
  const body = (message: string) => JSON.stringify({ type: "InvalidRequestException", message })

  it("explains a 404 of a job that ran and failed, keeping NOT_FOUND", () => {
    const error = httpError(
      response(404, body("Unknown property used in expression"), "application/json"),
      REQUEST,
      EXECUTE,
    )
    expect(error.code).toBe("NOT_FOUND")
    expect(error.details.hint).toBe(
      "The job ran and failed; the engine reports failures of job execute as 404. See `operate job get-stacktrace <id>` or `operate retry --incident <incident-id> --now`.",
    )
  })

  it('keeps the missing job hint for "No job found with id"', () => {
    const error = httpError(
      response(404, body("ENGINE-14026 No job found with id 'x'"), "application/json"),
      REQUEST,
      EXECUTE,
    )
    expect(error.details.hint).toBe(
      "Check the id or key. List the existing ones with `operate job list`.",
    )
  })
})

describe("httpError for a BPMN that does not parse", () => {
  const deploy = { method: "POST", url: "http://localhost:8080/engine-rest/deployment/create" }

  it("points to the first error, its line and the details in data", () => {
    const body = JSON.stringify({
      type: "ParseException",
      message: "ENGINE-09005 Could not parse BPMN process. Errors: ...",
      details: {
        "broken.bpmn": {
          errors: [
            {
              message: "Invalid destination 'missing' of sequence flow 'f1'\nsecond line",
              line: 5,
              column: 72,
            },
            { message: "other", line: 3, column: 49 },
          ],
          warnings: [],
        },
      },
    })
    const error = httpError(response(400, body, "application/json", "Bad Request"), deploy)
    expect(error.code).toBe("HTTP_CLIENT_ERROR")
    expect(error.details.hint).toBe(
      "The engine could not parse broken.bpmn: Invalid destination 'missing' of sequence flow 'f1' (line 5, column 72) and 1 more. Fix the file and deploy again; data.details lists every error with its line per resource.",
    )
  })

  it("stays readable without details, lines or with a long message", () => {
    const plain = JSON.stringify({ type: "ParseException", message: "broken" })
    expect(httpError(response(400, plain), deploy).details.hint).toBe(
      "The engine could not parse a resource. Fix the file and deploy again; data.details lists every error with its line per resource.",
    )
    const long = JSON.stringify({
      type: "ParseException",
      details: { "a.dmn": { errors: [{ message: "x".repeat(300) }, "odd"] } },
    })
    const hint = httpError(response(400, long), deploy).details.hint ?? ""
    expect(hint).toMatch(/^The engine could not parse a\.dmn: x{199}…\. Fix/)
  })
})
