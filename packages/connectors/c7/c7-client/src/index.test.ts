import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as sdk from "./generated/sdk.gen.js"
import * as types from "./generated/types.gen.js"
import * as client from "./index.js"

/**
 * The SDK's functions, one per operation of the one spec (c7-core's spec/patched/api.json), sorted
 * and one per line in test-support/sdk-functions.json: 399 names, too many for this file. A spec
 * patch, a new spec or a generator update that adds, drops or renames one fails here, so a
 * `pnpm generate` that changes the published SDK updates that list in the same commit.
 */
const SDK_FUNCTIONS = JSON.parse(
  readFileSync(new URL("./test-support/sdk-functions.json", import.meta.url), "utf8"),
) as string[]

/**
 * The published entries' lists: knip never reports what an entry exports, so a name added or
 * dropped is held here and decided in review. Types are erased at runtime: these are the runtime
 * names.
 */
describe("the @miragon/pulse-c7-client entries", () => {
  it("export exactly the client factory and the SDK-bound reads from the root", () => {
    expect(Object.keys(client).sort()).toEqual([
      "USER_AGENT",
      "createEngineClient",
      "endedBatchReport",
      "fetchExternalTaskErrorDetails",
      "fetchJobStacktrace",
      "queuedBatch",
      "readBatch",
      "readProcessInstanceVariables",
      "readTaskVariables",
      "runningBatchReport",
      "withCallerSignal",
    ])
  })

  it("export exactly one function per operation of the spec from ./sdk", () => {
    expect(Object.keys(sdk).sort()).toEqual(SDK_FUNCTIONS)
  })

  it("export no runtime value from ./types, which holds the spec's types only", () => {
    expect(Object.keys(types)).toEqual([])
  })
})
