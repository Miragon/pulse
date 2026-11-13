import { describe, expect, it } from "vitest"
import * as core from "../src/index.js"
import * as testing from "../src/testing/index.js"

describe("the @miragon/pulse-engine-core entries", () => {
  it("export exactly the ids, the failure kinds and the rules of the contract", () => {
    expect(Object.keys(core).sort()).toEqual([
      "BpmnProcessId",
      "BulkOperationId",
      "DefinitionId",
      "ElementId",
      "FailingRuntime",
      "IncidentId",
      "InstanceId",
      "IsoTimestamp",
      "MoveReasons",
      "PageCursor",
      "RootCauses",
      "RuntimeError",
      "ValueKinds",
    ])
  })

  it("export exactly the conformance kit, the fake engine and its world from ./testing", () => {
    expect(Object.keys(testing).sort()).toEqual([
      "CASE",
      "COMMAND_CASE",
      "ConformanceKit",
      "FakeEngine",
      "FakeWorld",
      "NEUTRAL_DIAGRAMS",
      "PatchedCommands",
      "PatchedRuntime",
      "WORLD_BULK_INSTANCES",
      "WORLD_COMMAND_INSTANCES",
      "WORLD_DEPLOYMENTS",
      "WORLD_ELEMENT",
      "WORLD_INSTANCES",
      "WORLD_LOCAL_VARIABLE",
      "WORLD_MIGRATION_INSTANCES",
      "WORLD_PROCESS",
      "WORLD_SECOND_TOKEN",
    ])
  })
})
