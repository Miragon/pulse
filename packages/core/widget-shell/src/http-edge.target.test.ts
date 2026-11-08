import http from "node:http"
import { describe, expect, it } from "vitest"
import { isNormalTarget, isUsableHost, isUsableMethod, pathOfTarget } from "./http-edge.js"

/** What the listener reads off a request as sent, before any URL parser sees it. */

describe("pathOfTarget", () => {
  it("cuts at the first question mark, without a URL parser", () => {
    expect(pathOfTarget("/mcp")).toBe("/mcp")
    expect(pathOfTarget("/mcp?x=1?y=2")).toBe("/mcp")
    expect(pathOfTarget("/./mcp?x")).toBe("/./mcp")
    expect(pathOfTarget("?x")).toBe("")
  })
})

describe("isNormalTarget", () => {
  it.each([
    "/",
    "/mcp",
    "/health/live",
    "/.well-known/oauth-protected-resource/mcp",
    "/fonts/geist-5.3.0/geist-latin-wght-normal.woff2",
    // A query is the app's, whatever it holds.
    "/mcp?",
    "/mcp?x=1",
    "/mcp?x=/../y",
    "/mcp?x=%2e%2e",
    "/mcp?x#y",
    "/mcp?a//b",
    // Dots that are no dot segment, and encodings no URL parser touches: they reach no route.
    "/...",
    "/a.b/c.d",
    "/.hidden",
    "/%6Dcp",
    "/mcp%2f",
    "/%5cmcp",
    "/mcp;x=1",
    "/MCP",
  ])("takes %s", (target) => {
    expect(isNormalTarget(target)).toBe(true)
  })

  it.each([
    // Dot segments, in every spelling the URL parser resolves.
    "/.",
    "/..",
    "/./mcp",
    "/../mcp",
    "/x/../mcp",
    "/mcp/.",
    "/mcp/..",
    "/mcp/x/..",
    "/%2e/mcp",
    "/%2E/mcp",
    "/%2e%2e/mcp",
    "/%2E%2E/mcp",
    "/.%2e/mcp",
    "/%2e./mcp",
    "/x/%2e%2e/mcp",
    "/mcp/%2e",
    "/./mcp?x=1",
    // Empty segments.
    "//",
    "//mcp",
    "/mcp/",
    "/mcp//",
    "/health//live",
    "/mcp/?x=1",
    // What the parser turns into a separator, strips or drops.
    "/\\mcp",
    "/mcp\\",
    "/health\\live",
    "/mcp#f",
    "/mcp#?x=1",
    "/m\tcp",
    "/mcp\n",
    "/m\x85cp",
    // Not origin-form.
    "",
    "*",
    "mcp",
    "?x=1",
    "http://127.0.0.1/mcp",
    "HTTP://127.0.0.1/mcp",
    "http://h\\.\\mcp",
  ])("refuses %j", (target) => {
    expect(isNormalTarget(target)).toBe(false)
  })

  it("agrees with the parser the bridge uses: what it takes keeps its path", () => {
    const bytes = Array.from({ length: 256 }, (_, code) => String.fromCharCode(code))
    for (const char of bytes) {
      for (const target of [`/${char}`, `/a${char}b`, `/${char}/mcp`, `/mcp/${char}`]) {
        if (!isNormalTarget(target)) continue
        const { pathname } = new URL(`http://localhost${target}`)
        expect(pathname).toBe(pathOfTarget(target))
      }
    }
  })
})

describe("isUsableHost", () => {
  it.each([
    undefined,
    "localhost",
    "LOCALHOST",
    "127.0.0.1:8400",
    "[::1]:8400",
    "mcp.example.com",
    "a_b.local",
    "h:",
  ])("takes %s", (host) => {
    expect(isUsableHost(host)).toBe(true)
  })

  it.each(["", "h/mcp?", "h/mcp#", "h\\mcp?", "h\\y", "h/", "h?y", "h#y", "/mcp"])(
    "refuses %j, which the URL would read as more than a host",
    (host) => {
      expect(isUsableHost(host)).toBe(false)
    },
  )

  it.each(["a b", "%", ":", "[", "h:abc", "h:99999", "h%2fmcp%3f", "\x85"])(
    "refuses %j, of which no URL can be built",
    (host) => {
      expect(isUsableHost(host)).toBe(false)
    },
  )

  it.each(["@", "user@h", "user:pw@h"])(
    "refuses %j, whose credentials the URL would hold",
    (host) => {
      expect(isUsableHost(host)).toBe(false)
    },
  )
})

describe("isUsableMethod", () => {
  const buildsARequest = (method: string): boolean => {
    try {
      new Request("http://h/", { method })
      return true
    } catch {
      return false
    }
  }

  it("agrees with the Request the bridge builds, on every method Node's parser knows", () => {
    const methods = [...http.METHODS, "TRACK"]
    const usable = methods.filter((method) => isUsableMethod(method))
    expect(usable).toEqual(methods.filter(buildsARequest))
    expect(methods.filter((method) => !isUsableMethod(method)).sort()).toEqual([
      "CONNECT",
      "TRACE",
      "TRACK",
    ])
  })
})
