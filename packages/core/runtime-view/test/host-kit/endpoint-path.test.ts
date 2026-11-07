import { describe, expect, test } from "vitest"
import { EndpointPath } from "../../src/host-kit/connections/endpoint-path.js"

describe("an endpoint path", () => {
  test.each([
    ["http://h/engine-rest/", "http://h/engine-rest"],
    ["http://h/engine-rest///", "http://h/engine-rest"],
    ["http://h/engine-rest", "http://h/engine-rest"],
    ["/a//b/", "/a//b"],
    ["///", ""],
    ["", ""],
  ])("drops the trailing slashes of %j", (path, expected) => {
    expect(EndpointPath.withoutTrailingSlashes(path)).toBe(expected)
  })

  test("reads a long run of inner slashes in linear time", () => {
    const path = `x${"/".repeat(200_000)}x`
    const start = performance.now()
    expect(EndpointPath.withoutTrailingSlashes(path)).toBe(path)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
