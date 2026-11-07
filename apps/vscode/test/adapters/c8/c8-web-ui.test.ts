import { describe, expect, test } from "vitest"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type InstanceSummary,
} from "../../../src/contract/index.js"

const DEFINITION = {
  id: DefinitionId("100"),
  bpmnProcessId: BpmnProcessId("order fulfilment"),
  version: 3,
}
const INSTANCE: InstanceSummary = {
  id: InstanceId("2251799813685329"),
  definition: DEFINITION,
  state: "running",
  hasIncident: false,
}

describe("the Operate links", () => {
  test.each([
    ["https://bru-2.api.camunda.io/cluster/operate"],
    ["https://bru-2.api.camunda.io/cluster/operate/"],
  ])("go into Operate at %s", (url) => {
    const webUi = new C8Adapter().webUi(url)

    expect(webUi?.name).toBe("Operate")
    expect(webUi?.overviewUrl()).toBe("https://bru-2.api.camunda.io/cluster/operate")
    expect(webUi?.instanceUrl(INSTANCE)).toBe(
      "https://bru-2.api.camunda.io/cluster/operate/processes/2251799813685329",
    )
    expect(webUi?.definitionUrl(DEFINITION)).toBe(
      "https://bru-2.api.camunda.io/cluster/operate/processes?processDefinitionId=order+fulfilment&processDefinitionVersion=3&active=true&incidents=true",
    )
  })

  test.each([
    ["the cluster root, which opens no web app since 8.9", "https://bru-2.api.camunda.io/cluster"],
    ["another web app", "http://localhost:8080/tasklist"],
    ["no URL", "not a url"],
  ])("are absent for %s", (_name, url) => {
    expect(new C8Adapter().webUi(url)).toBeUndefined()
  })
})
