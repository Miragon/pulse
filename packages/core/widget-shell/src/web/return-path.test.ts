import { describe, expect, it } from "vitest"
import { MAX_RETURN_TARGET, returnTarget } from "./return-path.js"

describe("returnTarget", () => {
  it("returns to the app's start without a target", () => {
    expect(returnTarget(undefined)).toBe("/app")
    expect(returnTarget(null)).toBe("/app")
    expect(returnTarget("")).toBe("/app")
  })

  it.each([
    "/app",
    "/app/boards/ops",
    "/app/cockpit",
    "/app/boards/a%20b",
    "/app/boards/ops.v2",
    // Pages whose names only begin like the sign-in's or the API's routes.
    "/app/authors",
    "/app/apis/x",
    "/app/boards/auth",
    // Encodings no URL parser resolves: one segment each, under /app as the router reads it.
    "/app/x%2f..%2fmcp",
    "/app/..%5cmcp",
  ])("keeps the app's path %s", (target) => {
    expect(returnTarget(target)).toBe(target)
  })

  it.each([
    // Another site, in every spelling a browser reads as one.
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/app",
    "http:/app",
    "javascript:alert(1)",
    " /app/boards",
    // Another route of this server, also through dot segments in any spelling.
    "/mcp",
    "/apple",
    "/app/../mcp",
    "/app/./boards",
    "/app/%2e%2e/mcp",
    "/app/%2E%2e/mcp",
    "/app/.%2e/mcp",
    // The sign-in's and the API's own routes: no page to return to (a GET of the logout is refused).
    "/app/auth",
    "/app/auth/login",
    "/app/auth/logout",
    "/app/auth/callback?code=x&state=y",
    "/app/api",
    "/app/api/session",
    "/app/api/call",
    // Not the normal form the listener lets through.
    "/app/",
    "/app//boards",
    "/app/boards/",
    "/app\\boards",
    "/app#fragment",
    "/app/boards#x?y",
    "/app/ü",
    "/app/a b",
    "/app/<script>",
    "/app/\nLocation: //evil.example",
    "app",
  ])("refuses %j and returns to /app", (target) => {
    expect(returnTarget(target)).toBe("/app")
  })

  it("keeps a query, read and written again, so it carries no character a header would read", () => {
    expect(returnTarget("/app/cockpit?view=instances&engine=prod")).toBe(
      "/app/cockpit?view=instances&engine=prod",
    )
    expect(returnTarget("/app?q=a b&r=a+b&s=%20&t")).toBe("/app?q=a+b&r=a+b&s=+&t=")
    expect(returnTarget("/app?x=1#frag")).toBe("/app?x=1%23frag")
    expect(returnTarget('/app?next=//evil.example&<b>="')).toBe(
      "/app?next=%2F%2Fevil.example&%3Cb%3E=%22",
    )
    expect(returnTarget("/app?x=\r\nSet-Cookie:a")).toBe("/app?x=%0D%0ASet-Cookie%3Aa")
    expect(returnTarget("/app/boards/ops?")).toBe("/app/boards/ops")
    expect(returnTarget("/app?a=1?b=2")).toBe("/app?a=1%3Fb%3D2")
  })

  it("refuses a query on a path it refuses", () => {
    expect(returnTarget("/mcp?x=/app")).toBe("/app")
    expect(returnTarget("//evil.example?/app")).toBe("/app")
  })

  it("keeps a target of up to 1,024 characters, also after its query is written again", () => {
    expect(MAX_RETURN_TARGET).toBe(1024)
    const longest = `/app?q=${"a".repeat(1024 - "/app?q=".length)}`
    expect(returnTarget(longest)).toBe(longest)
    expect(returnTarget(`${longest}a`)).toBe("/app")
    const path = `/app/${"b".repeat(1024 - "/app/".length)}`
    expect(returnTarget(path)).toBe(path)
    const shrinking = `/app?q=${"%61".repeat(340)}`
    expect(shrinking.length).toBeGreaterThan(1024)
    expect(returnTarget(shrinking)).toBe("/app")
    expect(returnTarget(`/app?q=${"%61".repeat(339)}`)).toBe(`/app?q=${"a".repeat(339)}`)
    const growing = `/app?q=${"~".repeat(340)}`
    expect(growing.length).toBeLessThan(1024)
    expect(returnTarget(growing)).toBe("/app")
    const fitting = `/app?q=${"~".repeat(339)}`
    expect(returnTarget(fitting)).toBe(`/app?q=${"%7E".repeat(339)}`)
    expect(returnTarget(fitting).length).toBe(1024)
  })
})
