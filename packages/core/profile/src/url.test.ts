import { describe, expect, it } from "vitest"
import {
  credentialsInClearText,
  isLoopbackHost,
  normalizeCockpitUrl,
  normalizeUrl,
  urlProblem,
} from "./url.js"

describe("urlProblem", () => {
  it.each([
    ["http://localhost:8080/engine-rest", undefined],
    ["  https://engine.example.com/engine-rest/  ", undefined],
    ["not a url", "url-invalid"],
    ["", "url-invalid"],
    ["https://demo:demo@shop.example.com/engine-rest", "url-credentials"],
    ["https://demo@shop.example.com/engine-rest", "url-credentials"],
    ["ftp://demo:demo@shop.example.com/", "url-credentials"],
    ["ftp://localhost/engine-rest", "url-not-http"],
    ["localhost:8080/engine-rest", "url-not-http"],
    ["file:///etc/passwd", "url-not-http"],
    ["http://localhost:8080/engine-rest?tenant=acme", "url-query-or-fragment"],
    ["http://localhost:8080/engine-rest?", "url-query-or-fragment"],
    ["http://localhost:8080/engine-rest#top", "url-query-or-fragment"],
  ])("%j: %s", (url, problem) => {
    expect(urlProblem(url)).toBe(problem)
  })
})

describe("normalizing", () => {
  it("trims a REST root and drops its trailing slashes", () => {
    expect(normalizeUrl("  http://a:8080/engine-rest///  ")).toBe("http://a:8080/engine-rest")
    expect(normalizeUrl("http://a:8080/engine-rest#")).toBe("http://a:8080/engine-rest#")
  })

  it("also drops the start route of a web app, never a route inside it", () => {
    expect(normalizeCockpitUrl(" http://a/app/cockpit/default/#/ ")).toBe(
      "http://a/app/cockpit/default",
    )
    expect(normalizeCockpitUrl("http://a/app/#/dashboard")).toBe("http://a/app/#/dashboard")
    expect(urlProblem(normalizeCockpitUrl("http://a/app/#/dashboard"))).toBe(
      "url-query-or-fragment",
    )
  })
})

describe("isLoopbackHost", () => {
  it.each([
    ["localhost", true],
    ["LOCALHOST", true],
    ["[::1]", true],
    ["127.0.0.1", true],
    ["127.0.0.2", true],
    ["127.255.255.254", true],
    ["128.0.0.1", false],
    ["localhost.example.com", false],
    ["0.0.0.0", false],
    ["engine", false],
  ])("%s: %s", (host, loopback) => {
    expect(isLoopbackHost(host)).toBe(loopback)
  })
})

describe("credentialsInClearText", () => {
  it("is true for credentials over http beyond the loopback interface", () => {
    for (const type of ["basic", "bearer", "oauth", "passthrough"] as const) {
      expect(credentialsInClearText("http://engine:8080/engine-rest", type), type).toBe(true)
    }
  })

  it("is false without credentials, over https, on loopback or for no URL", () => {
    expect(credentialsInClearText("http://engine:8080/engine-rest", "none")).toBe(false)
    expect(credentialsInClearText("https://engine/engine-rest", "basic")).toBe(false)
    expect(credentialsInClearText(" http://127.0.0.2:8080/engine-rest", "basic")).toBe(false)
    expect(credentialsInClearText("http://[::1]:8080/engine-rest", "bearer")).toBe(false)
    expect(credentialsInClearText("not a url", "basic")).toBe(false)
  })
})
