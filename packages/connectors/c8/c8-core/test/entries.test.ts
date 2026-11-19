import { describe, expect, it } from "vitest"
import * as core from "../src/index.js"
import * as testing from "../src/testing/index.js"

describe("the @miragon/pulse-c8-core entry", () => {
  it("exports exactly the runtime, the rule of its failures and the REST client it is built on", () => {
    expect(Object.keys(core).sort()).toStrictEqual([
      "C8Failures",
      "C8Runtime",
      "RestCamundaClient",
      "UnexpectedAnswerError",
    ])
  })
})

describe("the @miragon/pulse-c8-core/testing entry", () => {
  it("exports exactly the recorded board engine and the seed of the conformance world", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(["C8WorldSeed", "C8_BOARD_ENGINE"])
  })
})
