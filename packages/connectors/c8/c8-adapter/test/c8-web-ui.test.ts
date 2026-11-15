import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type InstanceSummary,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"

const DEFINITION = {
  id: DefinitionId("100"),
  bpmnProcessId: BpmnProcessId("order fulfilment"),
  version: 3,
}
const INSTANCE: InstanceSummary = {
  id: InstanceId("2251799813685329"),
  definition: DEFINITION,
  state: "running",
  hasIncident: true,
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

  test("keep the origin and the path to Operate, never a query or a route copied along", () => {
    const webUi = new C8Adapter().webUi("http://localhost:8080/operate?tab=2#/processes")

    expect(webUi?.overviewUrl()).toBe("http://localhost:8080/operate")
  })

  test.each([
    ["the cluster root, which opens no web app since 8.9", "https://bru-2.api.camunda.io/cluster"],
    ["another web app", "http://localhost:8080/tasklist"],
    ["a path that only starts with Operate", "http://localhost:8080/operate/processes"],
    ["no URL", "not a url"],
  ])("are absent for %s", (_name, url) => {
    expect(new C8Adapter().webUi(url)).toBeUndefined()
  })
})
