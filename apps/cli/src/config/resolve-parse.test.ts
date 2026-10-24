/** Parsing of the timeout, the extra headers and the read-only switch (resolve.ts, headers.ts). */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { file } from "../../test/support/config-resolve.js"
import { failure } from "../../test/support/failure.js"
import { OperateError } from "../errors.js"
import { isHeaderName, isHeaderValue, parseHeader, parseHeaders } from "./headers.js"
import { MAX_TIMEOUT_MS, isTimeout, parseReadOnly, parseTimeout, resolveConfig } from "./resolve.js"

describe("parseTimeout", () => {
  it.each([
    ["1", 1],
    ["250", 250],
    [" 60000 ", 60000],
    [1, 1],
    [MAX_TIMEOUT_MS, MAX_TIMEOUT_MS],
    [String(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS],
  ])("parses %j as %i", (input, output) => {
    expect(parseTimeout(input)).toBe(output)
  })

  it.each(["0", "-1", "1.5", "1e3", "0x10", "", " ", "abc", "10ms", 0, -5, 1.5, Number.NaN])(
    "rejects %j",
    (input) => {
      const error = failure(() => parseTimeout(input))
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        `Timeout must be a positive number of milliseconds, got "${String(input)}"`,
      )
      expect(error.details.hint).toBe(
        "Use a whole number between 1 and 2147483647, e.g. 60000 for one minute.",
      )
    },
  )

  it("rejects timeouts above the timer limit", () => {
    expect(() => parseTimeout(MAX_TIMEOUT_MS + 1)).toThrow(OperateError)
    expect(() => parseTimeout(String(MAX_TIMEOUT_MS + 1))).toThrow(OperateError)
  })

  it("isTimeout only accepts whole numbers in range", () => {
    expect(isTimeout(1)).toBe(true)
    expect(isTimeout(MAX_TIMEOUT_MS)).toBe(true)
    expect(isTimeout(0)).toBe(false)
    expect(isTimeout(MAX_TIMEOUT_MS + 1)).toBe(false)
    expect(isTimeout(2.5)).toBe(false)
    expect(isTimeout("5")).toBe(false)
    expect(isTimeout(undefined)).toBe(false)
  })
})

describe("parseHeader", () => {
  it.each([
    ["X-Tenant-Id: acme", ["X-Tenant-Id", "acme"]],
    ["  X-A :  b c  ", ["X-A", "b c"]],
    ["Authorization: Bearer a:b:c", ["Authorization", "Bearer a:b:c"]],
    ["X-Empty:", ["X-Empty", ""]],
    ["x!#$%&'*+.^_`|~1: v", ["x!#$%&'*+.^_`|~1", "v"]],
  ])("parses %j", (input, output) => {
    expect(parseHeader(input)).toEqual(output)
  })

  const hint = 'Use the form "Name: value", e.g. "X-Tenant-Id: acme".'

  it("rejects a header without a colon and does not repeat it", () => {
    const error = failure(() => parseHeader("Authorization Bearer secret"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Invalid header: expected "Name: value"')
    expect(error.details.hint).toBe(hint)
  })

  it.each([
    [": value", ""],
    ["X Y: value", "X Y"],
    ["X(Y): value", "X(Y)"],
    ["Ä: value", "Ä"],
  ])("rejects the header name in %j", (input, name) => {
    const error = failure(() => parseHeader(input))
    expect(error.message).toBe(`Invalid header name "${name}"`)
    expect(error.details.hint).toBe(hint)
  })

  it.each(["X: a\nb", "X: a\rb", "X: a\0b", "X: a\u0001b", "X: a\u007fb", "X: \u001b[2J"])(
    "rejects control characters in %j",
    (input) => {
      const error = failure(() => parseHeader(input))
      expect(error.message).toBe(
        'Invalid value for header "X": control characters (line breaks, NUL, ESC, DEL, ...) are not allowed',
      )
    },
  )

  it.each(["Connection", "content-length", "Expect", "Keep-Alive", "TRANSFER-ENCODING", "Upgrade"])(
    "rejects the client managed header %s",
    (name) => {
      const error = failure(() => parseHeader(`${name}: x`))
      expect(error.message).toBe(`Header "${name}" cannot be set: the HTTP client manages it`)
      expect(error.details.hint).toBe(
        "Remove it. Not allowed: connection, content-length, expect, keep-alive, transfer-encoding, upgrade.",
      )
      expect(isHeaderName(name)).toBe(false)
    },
  )

  it.each(["X: 日本", "X: \u0100", "X: emoji 😀", "X: \ud800"])(
    "rejects characters beyond ISO-8859-1 in %j without repeating the value",
    (input) => {
      const error = failure(() => parseHeader(input))
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        'Invalid value for header "X": only ISO-8859-1 (Latin-1) characters are allowed',
      )
      expect(error.details.hint).toBe(
        "Encode other characters, e.g. with percent-encoding or Base64.",
      )
    },
  )

  it("accepts tabs and every printable ISO-8859-1 character", () => {
    expect(parseHeader("X: Jos\u00e9 M\u00fcller \u00ff\tb\u00a0c")).toEqual([
      "X",
      "Jos\u00e9 M\u00fcller \u00ff\tb\u00a0c",
    ])
  })

  it("isHeaderValue checks line breaks, NUL and the Latin-1 range", () => {
    expect(isHeaderValue("")).toBe(true)
    expect(isHeaderValue("Bearer a.b-c_d~e+f/g=")).toBe(true)
    expect(isHeaderValue("\u00ff")).toBe(true)
    expect(isHeaderValue("\u0100")).toBe(false)
    expect(isHeaderValue("a\rb")).toBe(false)
    expect(isHeaderValue("a\nb")).toBe(false)
    expect(isHeaderValue("a\0b")).toBe(false)
    expect(isHeaderValue("a\u0085b")).toBe(false)
    expect(isHeaderValue("a\tb")).toBe(true)
  })

  it('round-trips valid "Name: value" headers', () => {
    const name = fc.stringMatching(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
    const latin1 = fc.integer({ min: 0, max: 0xff }).map((code) => String.fromCharCode(code))
    const value = fc
      .string({ unit: latin1 })
      .map((text) => text.replace(/[^\P{Cc}\t]/gu, "").trim())
    const allowed = name.filter((candidate) => isHeaderName(candidate))
    fc.assert(
      fc.property(allowed, value, (headerName, headerValue) => {
        expect(parseHeader(`${headerName}: ${headerValue}`)).toEqual([headerName, headerValue])
        expect(parseHeader(`${headerName}:${headerValue}`)).toEqual([headerName, headerValue])
      }),
    )
  })

  it("parseHeaders merges into one map, later headers win", () => {
    expect(parseHeaders(["A: 1", "B: 2", "a: 3"])).toEqual({ B: "2", a: "3" })
    expect(parseHeaders([])).toEqual({})
  })
})

describe("parseReadOnly", () => {
  it.each(["1", "true", "TRUE", " yes ", "Yes", "on"])("reads %j as true", (value) => {
    expect(parseReadOnly(value)).toBe(true)
  })

  it.each(["0", "false", "False", "no", " off "])("reads %j as false", (value) => {
    expect(parseReadOnly(value)).toBe(false)
  })

  it.each([undefined, "", "   "])("treats %j as unset", (value) => {
    expect(parseReadOnly(value)).toBeUndefined()
  })

  it("rejects other values instead of silently disabling read-only mode", () => {
    const error = failure(() => parseReadOnly("Enabled"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Invalid OPERATE_READ_ONLY value "enabled"')
    expect(error.details.hint).toBe("Use one of: 1, true, yes, on, 0, false, no, off.")
  })

  it("keeps a read-only profile read-only when OPERATE_READ_ONLY is empty", () => {
    const resolved = resolveConfig({}, { OPERATE_READ_ONLY: "" }, file({ readOnly: true }))
    expect(resolved.readOnly).toBe(true)
    expect(resolved.sources.readOnly).toBe("profile")
  })
})
