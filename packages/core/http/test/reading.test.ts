import { describe, expect, it } from "vitest"
import { decodeText, mediaTypeOf, problemOf, STATUS_TEXT, statusTextOf } from "../src/index.js"
import { reasonOfCode, systemCode } from "../src/thrown.js"

const body = (text: string, contentType: string) => ({
  body: new TextEncoder().encode(text),
  contentType,
})

describe("statusTextOf", () => {
  it("keeps the server's phrase, else the standard one, else nothing", () => {
    expect(statusTextOf(404, "Gone Fishing")).toBe("Gone Fishing")
    expect(statusTextOf(404, "")).toBe("Not Found")
    expect(statusTextOf(599, "")).toBe("")
    expect(STATUS_TEXT[401]).toBe("Unauthorized")
  })
})

describe("decodeText and mediaTypeOf", () => {
  it("decodes in the declared charset, UTF-8 when none or an unknown one", () => {
    const latin1 = {
      body: Uint8Array.from([0x68, 0xe9]),
      contentType: 'text/plain; charset="ISO-8859-1"',
    }
    expect(decodeText(latin1)).toBe("hé")
    expect(decodeText(body("hé", "text/plain"))).toBe("hé")
    expect(decodeText(body("hé", "text/plain; charset=x-unknown"))).toBe("hé")
  })

  it("reads the media type without parameters, in lower case", () => {
    expect(mediaTypeOf("Text/XML; charset=UTF-8")).toBe("text/xml")
    expect(mediaTypeOf("")).toBe("")
  })
})

describe("problemOf", () => {
  it("reads an exception's type, message and code", () => {
    const json = '{"type":"InvalidRequestException","message":"gone","code":42}'
    expect(problemOf(body(json, "application/json"))).toStrictEqual({
      type: "InvalidRequestException",
      message: "gone",
      code: 42,
    })
  })

  it.each([
    ['{"detail":"d","title":"t"}', { message: "d" }],
    ['{"error_description":"e","error":"invalid_grant"}', { message: "e" }],
    ['{"error":"Unauthorized"}', { message: "Unauthorized" }],
    ['{"title":"NOT_FOUND"}', { message: "NOT_FOUND" }],
    ['{"type":"https://example.com/problem","message":" "}', {}],
    ['{"type":"a b c"}', {}],
    ["[1,2]", {}],
    ["null", {}],
    ["{", {}],
  ])("reads %s", (json, problem) => {
    expect(problemOf(body(json, "application/problem+json"))).toStrictEqual(problem)
  })

  it("reads a plain text body as the message, an HTML page as nothing", () => {
    expect(problemOf(body("  Cannot deserialize\n", "text/plain"))).toStrictEqual({
      message: "Cannot deserialize",
    })
    expect(problemOf(body("<h1>404</h1>", "text/html;charset=utf-8"))).toStrictEqual({})
    expect(problemOf(body("   ", "text/plain"))).toStrictEqual({})
    expect(problemOf(body("\u0000", "application/octet-stream"))).toStrictEqual({})
  })
})

describe("what a failed fetch threw", () => {
  const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause })

  it("reads the code of the cause, of an AggregateError's first, or the error's own", () => {
    expect(systemCode(fetchFailed({ code: "ECONNREFUSED" }))).toBe("ECONNREFUSED")
    const aggregate = new AggregateError([{ code: "ECONNREFUSED" }, { code: "EHOSTUNREACH" }])
    expect(systemCode(fetchFailed(aggregate))).toBe("ECONNREFUSED")
    expect(systemCode({ code: "ERR_INVALID_URL" })).toBe("ERR_INVALID_URL")
    expect(systemCode(fetchFailed({ code: "not a code: secret" }))).toBeUndefined()
    for (const code of ["x ECONNREFUSED", "ECONNREFUSED x", "E-X", "E", 42]) {
      expect(systemCode({ code }), String(code)).toBeUndefined()
    }
    expect(systemCode(undefined)).toBeUndefined()
    expect(systemCode(null)).toBeUndefined()
    expect(systemCode("text")).toBeUndefined()
    expect(systemCode(fetchFailed({ errors: "no list" }))).toBeUndefined()
  })

  it.each([
    [undefined, "connection"],
    ["ECONNRESET", "connection"],
    ["UND_ERR_SOCKET", "connection"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
    ["CERT_HAS_EXPIRED", "tls"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls"],
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ECONNREFUSED", "unreachable"],
    ["UND_ERR_CONNECT_TIMEOUT", "unreachable"],
    ["UND_ERR_INVALID_ARG", "invalid-request"],
    ["ERR_INVALID_URL", "invalid-request"],
  ])("%s is %s", (code, reason) => {
    expect(reasonOfCode(code)).toBe(reason)
  })
})
