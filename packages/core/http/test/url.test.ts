import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  encodePathValue,
  joinUrl,
  PathValueError,
  pathValueProblem,
  requestUrlProblem,
  rootOf,
} from "../src/index.js"
import { targetOf, withoutTrailingSlashes } from "../src/url.js"

describe("the path value rule", () => {
  it.each([
    ["", "empty"],
    [".", "dot-segment"],
    ["..", "dot-segment"],
  ])("refuses %j (%s)", (value, problem) => {
    expect(pathValueProblem(value)).toBe(problem)
    expect(() => encodePathValue(value)).toThrow(new PathValueError(problem as "empty"))
  })

  it("names the problem, never the value", () => {
    const error = new PathValueError("dot-segment")
    expect(error.message).toBe("path value refused: dot-segment")
    expect(error.name).toBe("PathValueError")
    expect(error.problem).toBe("dot-segment")
  })

  it("encodes every other value into one segment the parser leaves alone", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        fc.pre(pathValueProblem(value) === undefined)
        const url = `http://h/r/${encodePathValue(value)}/x`
        expect(new URL(url).pathname.split("/")).toHaveLength(4)
        expect(requestUrlProblem(url, "http://h/r")).toBeUndefined()
      }),
    )
  })

  it.each(["...", " .", "%2e", "a.b", "pi-1"])("takes %j", (value) => {
    expect(pathValueProblem(value)).toBeUndefined()
  })
})

describe("rootOf", () => {
  it.each([
    ["http://localhost:8080/engine-rest", "http://localhost:8080/engine-rest"],
    ["http://localhost:8080/engine-rest//", "http://localhost:8080/engine-rest"],
    ["HTTP://Engine.Example.com:80/engine-rest/", "http://engine.example.com/engine-rest"],
    ["https://h/a/../engine-rest", "https://h/engine-rest"],
    ["http://h", "http://h"],
  ])("normalizes %s", (url, root) => {
    expect(rootOf(url)).toBe(root)
  })

  it.each([
    ["not a url", "no absolute URL"],
    ["ftp://h/x", "http or https"],
    ["http://demo:secret@h/x", "credentials"],
    ["http://h/x?a=1", "query or fragment"],
    ["http://h/x?", "query or fragment"],
    ["http://h/x#top", "query or fragment"],
  ])("refuses %s, naming no part of it", (url, why) => {
    expect(() => rootOf(url)).toThrow(RangeError)
    expect(() => rootOf(url)).toThrow(why)
    try {
      rootOf(url)
    } catch (error) {
      expect(String(error)).not.toContain("secret")
    }
  })
})

describe("joinUrl", () => {
  it("joins root, path and query without normalizing anything", () => {
    expect(joinUrl("http://h/r/", "/process-instance/.")).toBe("http://h/r/process-instance/.")
    expect(joinUrl("http://h/r", "task")).toBe("http://h/r/task")
    expect(joinUrl("http://h/r", "")).toBe("http://h/r")
  })

  it("writes a query from values, lists and URLSearchParams, skipping undefined", () => {
    const query = { a: "x y", b: 2, c: true, d: undefined, e: ["1", "2"] }
    expect(joinUrl("http://h/r", "/x", query)).toBe("http://h/r/x?a=x+y&b=2&c=true&e=1&e=2")
    expect(joinUrl("http://h/r", "/x", new URLSearchParams({ q: "&" }))).toBe("http://h/r/x?q=%26")
    expect(joinUrl("http://h/r", "/x", {})).toBe("http://h/r/x")
  })
})

describe("requestUrlProblem", () => {
  const root = "http://h:8080/engine-rest"

  it.each([
    ["http://h:8080/engine-rest/process-instance/pi-1", undefined],
    ["http://h:8080/engine-rest", undefined],
    ["http://h:8080/engine-rest/x?a=..&b=", undefined],
    // The query is cut off whole before the path is read: a slash in it is no segment.
    ["http://h:8080/engine-rest/x?q=/../y", undefined],
    ["http://h:8080/engine-rest/x#/../y", undefined],
    ["http://h:8080/engine-rest/a/.?x=1", "dot-segment"],
    ["http://H:8080/engine-rest/x", undefined],
    ["not a url", "not-a-url"],
    ["http://demo:pw@h:8080/engine-rest/x", "credentials"],
    ["http://demo@h:8080/engine-rest/x", "credentials"],
    ["http://:pw@h:8080/engine-rest/x", "credentials"],
    ["http://other:8080/engine-rest/x", "outside-root"],
    ["https://h:8080/engine-rest/x", "outside-root"],
    ["http://h:8080/engine-restx/x", "outside-root"],
    ["http://h:8080/other", "outside-root"],
    ["http://h:8080/engine-rest/process-instance/.", "dot-segment"],
    ["http://h:8080/engine-rest/process-instance/..", "dot-segment"],
    ["http://h:8080/engine-rest/../x", "dot-segment"],
    ["http://h:8080/engine-rest/a/%2E%2e/b", "dot-segment"],
    ["http://h:8080/engine-rest/a/.%2e", "dot-segment"],
    ["http://h:8080/engine-rest/a\\..\\b", "dot-segment"],
    ["http://h:8080/engine-rest/a/.\t./b", "dot-segment"],
    ["http://h:8080/engine-rest/process-instance/", "empty-segment"],
    ["http://h:8080/engine-rest//x", "empty-segment"],
    ["http://h:8080/engine-rest/a//b", "empty-segment"],
  ])("%s: %s", (url, problem) => {
    expect(requestUrlProblem(url, root)).toBe(problem)
  })

  it("reads the dot segments of the path alone, never of the origin before it", () => {
    expect(requestUrlProblem("http://../engine-rest/x", rootOf("http://../engine-rest"))).toBe(
      undefined,
    )
  })

  it("reads the path below a root whose own path has an empty segment", () => {
    const root = rootOf("http://h//engine-rest")
    expect(requestUrlProblem("http://h//engine-rest/x", root)).toBeUndefined()
    expect(requestUrlProblem("http://h//engine-rest//x", root)).toBe("empty-segment")
  })

  it("takes the origin itself below a root without a path", () => {
    expect(requestUrlProblem("http://h/", "http://h")).toBeUndefined()
    expect(requestUrlProblem("http://h/x", "http://h")).toBeUndefined()
    expect(requestUrlProblem("http://h//x", "http://h")).toBe("empty-segment")
  })
})

describe("targetOf", () => {
  it("is origin and path, never a query, a fragment or credentials", () => {
    expect(targetOf("http://demo:pw@h:8080/r/x?token=abc#f")).toBe("http://h:8080/r/x")
    expect(targetOf("no url")).toBe("")
  })

  it("trims trailing slashes in linear time", () => {
    expect(withoutTrailingSlashes(`a${"/".repeat(100_000)}`)).toBe("a")
    expect(withoutTrailingSlashes("////")).toBe("")
  })
})
