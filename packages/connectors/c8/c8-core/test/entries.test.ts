import { describe, expect, it } from "vitest"
import * as core from "../src/index.js"

describe("the @miragon/pulse-c8-core entry", () => {
  it("exports exactly the REST client, the readers and the mappings the C8 runtime is built of", () => {
    expect(Object.keys(core).sort()).toStrictEqual([
      "CalledProcessReader",
      "DefinitionReader",
      "DefinitionRefsCache",
      "Diagrams",
      "ElementStatisticsReader",
      "IncidentSearch",
      "IncidentTexts",
      "InstanceDetailReader",
      "InstanceSearch",
      "Keys",
      "RestCamundaClient",
      "UnexpectedAnswerError",
      "VariableNameReader",
      "VersionFloor",
    ])
  })
})
