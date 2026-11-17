import { describe, expect, it } from "vitest"
import * as core from "../src/index.js"

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
