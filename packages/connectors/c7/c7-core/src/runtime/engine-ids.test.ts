import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { engineIdOf, isEngineId } from "./engine-ids.js"

const ENGINE_IDS = [
  "a",
  "z",
  "A",
  "Z",
  "0",
  "9",
  "_",
  "order:3:1f2e3d4c-aaaa-bbbb-cccc-0123456789ab",
  "Activity_1.instance",
  "b-1",
  "b.1",
  "b:1",
  "b_1",
  "a0Z9_",
  "aZ",
  "a9",
]

const NO_ENGINE_IDS = [
  "",
  "-a",
  ".a",
  ":a",
  " a",
  "a b",
  "a/b",
  "a/",
  "/a",
  "..",
  "a?b=1",
  "a#b",
  "a%2F",
  "a\n",
  "\na",
  "é",
  "aé",
  "a,b",
  "a+b",
]

describe("isEngineId", () => {
  it.each(ENGINE_IDS)("accepts %j", (value) => {
    expect(isEngineId(value)).toBe(true)
  })

  it.each(NO_ENGINE_IDS)("refuses %j", (value) => {
    expect(isEngineId(value)).toBe(false)
  })
})

describe("engineIdOf", () => {
  it("is an engine id as it is", () => {
    expect(engineIdOf("order:3:1f2")).toBe("order:3:1f2")
  })

  it("fails a value no engine assigns as misconfigured, in words that name it", () => {
    const failure = (() => {
      try {
        return engineIdOf("../batch")
      } catch (error: unknown) {
        return error
      }
    })()
    expect(failure).toBeInstanceOf(RuntimeError)
    expect(failure).toMatchObject({
      failure: "misconfigured",
      message: '"../batch" as an identifier is not accepted',
    })
  })
})
