import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { installRequestLog, logRefusedRequest } from "./request-log.js"

/** A path is the caller's: whatever it holds, the log writes one line of a bounded length. */

let log: MockInstance<(line: string) => void>

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The one line written so far, its time made stable. */
const onlyLine = () => {
  expect(log).toHaveBeenCalledOnce()
  return String(log.mock.calls[0][0]).replace(/ \d+ms\b/, " Nms")
}

const NO_LINE_BREAK = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

describe("the request log: a routed path", () => {
  // Hono's default router decodes the path, so this reads what a raw one could put in the line.
  const get = (path: string) => {
    const app = new Hono()
    installRequestLog(app, "/mcp")
    return app.fetch(new Request(`http://localhost${path}`))
  }

  it.each([
    ["a line feed", "/a%0Ab", "/a?b"],
    ["a carriage return", "/a%0Db", "/a?b"],
    ["a tab", "/a%09b", "/a?b"],
    ["an ANSI escape", "/a%1B[31mb", "/a?[31mb"],
  ])("writes %s as one line", async (_name, path, shown) => {
    await get(path)
    expect(onlyLine().replace(/ Nms$/, "")).toBe(`GET ${shown} 404`)
  })

  it("cuts a long path", async () => {
    await get(`/${"a".repeat(5000)}`)
    expect(onlyLine().length).toBeLessThan(300)
  })
})

describe("logRefusedRequest", () => {
  const refused = (target: string, method = "GET") =>
    logRefusedRequest({ method, target, status: 404, message: "Not found: not its normal form." })

  it("names the path as sent, the status and the reason", () => {
    refused("/./mcp", "POST")
    expect(onlyLine()).toBe("POST /./mcp 404 Nms ERROR Not found: not its normal form.")
  })

  it("leaves the query out, like every other line", () => {
    refused("/./mcp?token=s3cret")
    expect(onlyLine()).toBe("GET /./mcp 404 Nms ERROR Not found: not its normal form.")
  })

  it.each([
    "/a\nb",
    "/a\r\nGET /forged 200 1ms",
    "/a\u0085b",
    "/a\u2028b",
    "/a\u2029b",
    "/a\u202eb",
    "/a\u001b[31m",
  ])("keeps %j on one line", (target) => {
    refused(target)
    const line = String(log.mock.calls[0][0])
    expect(log).toHaveBeenCalledOnce()
    expect(line).not.toMatch(NO_LINE_BREAK)
    expect(line).toMatch(/^GET \/a\?.* 404 0ms ERROR /)
  })

  it("cuts a long path", () => {
    refused(`/./${"a".repeat(5000)}`)
    const line = onlyLine()
    expect(line.length).toBeLessThan(300)
    expect(line).toContain("… 404 Nms")
  })

  it.each(["/mcp#access_token=s3cret", "/mcp#a?b=s3cret", "/mcp?x#s3cret"])(
    "leaves the fragment of %s out too",
    (target) => {
      refused(target)
      expect(onlyLine()).toBe("GET /mcp 404 Nms ERROR Not found: not its normal form.")
    },
  )

  it.each([
    "http://user:s3cret@127.0.0.1/mcp",
    "//user:s3cret@127.0.0.1/mcp",
    "/\\user:s3cret@127.0.0.1/mcp",
    "*",
    "",
  ])("shows no target that is not a path: %j can carry credentials", (target) => {
    refused(target)
    expect(onlyLine()).toBe("GET (not origin-form) 404 Nms ERROR Not found: not its normal form.")
  })
})
