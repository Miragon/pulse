import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type InstanceSummary,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"

const DEFINITION = {
  id: DefinitionId("order-fulfillment:3:5f1c-11f1"),
  bpmnProcessId: BpmnProcessId("order-fulfillment"),
  version: 3,
}

function instance(hasIncident: boolean): InstanceSummary {
  return {
    id: InstanceId("63d65e9e-cd7f-11f1-86d2-667bc3771e0d"),
    definition: DEFINITION,
    state: "running",
    hasIncident,
  }
}

function webUiAt(webUiUrl: string) {
  return C7Adapter.create({ cliPath: "engine-cli.js", configPath: "config.json" }).webUi(webUiUrl)
}

describe("links into the Cockpit of a C7 family engine", () => {
  test("use the dashboard and the hash routes of the classic Cockpit, with the incidents tab when there is one", () => {
    const cockpit = webUiAt("http://localhost:18090/operaton/app/cockpit/default/")

    expect(cockpit?.name).toBe("Cockpit")
    expect(cockpit?.overviewUrl()).toBe(
      "http://localhost:18090/operaton/app/cockpit/default/#/dashboard",
    )
    expect(cockpit?.instanceUrl(instance(false))).toBe(
      "http://localhost:18090/operaton/app/cockpit/default/#/process-instance/63d65e9e-cd7f-11f1-86d2-667bc3771e0d/runtime",
    )
    expect(cockpit?.instanceUrl(instance(true))).toBe(
      "http://localhost:18090/operaton/app/cockpit/default/#/process-instance/63d65e9e-cd7f-11f1-86d2-667bc3771e0d/runtime?detailsTab=incidents-tab",
    )
    expect(cockpit?.definitionUrl(DEFINITION)).toBe(
      "http://localhost:18090/operaton/app/cockpit/default/#/process-definition/order-fulfillment:3:5f1c-11f1/runtime",
    )
  })

  test("take the engine name from the path, without a trailing slash or a copied route", () => {
    const cockpit = webUiAt("https://ops.example.com/camunda/app/cockpit/shop#/dashboard")

    expect(cockpit?.overviewUrl()).toBe(
      "https://ops.example.com/camunda/app/cockpit/shop/#/dashboard",
    )
    expect(cockpit?.definitionUrl(DEFINITION)).toBe(
      "https://ops.example.com/camunda/app/cockpit/shop/#/process-definition/order-fulfillment:3:5f1c-11f1/runtime",
    )
  })

  test("use the start page and the routes of the CIB seven webclient under /webapp/", () => {
    const webclient = webUiAt("http://localhost:18091/webapp/")

    expect(webclient?.overviewUrl()).toBe("http://localhost:18091/webapp/#/seven/auth/start")
    expect(webclient?.instanceUrl(instance(true))).toBe(
      "http://localhost:18091/webapp/#/seven/auth/processes/instance/63d65e9e-cd7f-11f1-86d2-667bc3771e0d?tab=incidents",
    )
    expect(webclient?.instanceUrl(instance(false))).toBe(
      "http://localhost:18091/webapp/#/seven/auth/processes/instance/63d65e9e-cd7f-11f1-86d2-667bc3771e0d",
    )
    expect(webclient?.definitionUrl(DEFINITION)).toBe(
      "http://localhost:18091/webapp/#/seven/auth/processes/definition/order-fulfillment:3:5f1c-11f1?tab=instances",
    )
  })

  test("keep an id from breaking out of its route", () => {
    const cockpit = webUiAt("http://localhost:18090/camunda/app/cockpit/default/")

    expect(cockpit?.definitionUrl({ ...DEFINITION, id: DefinitionId("a/b?c#d") })).toBe(
      "http://localhost:18090/camunda/app/cockpit/default/#/process-definition/a%2Fb%3Fc%23d/runtime",
    )
  })

  test("are not guessed from an unknown path or a missing setting", () => {
    expect(webUiAt("")).toBeUndefined()
    expect(webUiAt("http://localhost:18090/")).toBeUndefined()
    expect(webUiAt("http://localhost:18090/camunda/app/tasklist/default/")).toBeUndefined()
    expect(webUiAt("not a url")).toBeUndefined()
  })
})
