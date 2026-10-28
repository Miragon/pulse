import { describe, expect, it } from "vitest"
import { viewRows } from "./auth-output.js"

describe("viewRows", () => {
  it("joins lists with spaces and shows null as empty", () => {
    expect(viewRows({ profile: null, audience: ["a", "b"], cached: true })).toEqual([
      { KEY: "profile", VALUE: "" },
      { KEY: "audience", VALUE: "a b" },
      { KEY: "cached", VALUE: true },
    ])
  })
})
