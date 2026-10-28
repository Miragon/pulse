import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import {
  buildCockpitDashboardData,
  buildProcessInstancesData,
  buildProcessListData,
} from "./cockpit-data.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

const statsRow = (key: string, version: number, over: Record<string, unknown> = {}) => ({
  id: `${key}:${version}:d`,
  definition: { id: `${key}:${version}:d`, key, name: key.toUpperCase(), version },
  ...over,
})

// One rule with analytics (#322 U13): an unnamed process takes its Modeler
// pool name ("Miravelo - Bike Leasing", not `miraveloLeasing`).
describe("the lists name a Modeler pool's unnamed process as analytics does", () => {
  const POOLED_XML = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Pool" name="Miravelo - Bike Leasing" processRef="miraveloLeasing" />
  </bpmn:collaboration>
  <bpmn:process id="miraveloLeasing" isExecutable="true" />
</bpmn:definitions>`
  const LEASING = "miraveloLeasing:3:d"
  const xmlRoute = {
    [`GET /process-definition/${LEASING}/xml`]: { body: { bpmn20Xml: POOLED_XML } },
  }

  it("in the landscape, reading only the unnamed definition's diagram", async () => {
    const { engine, client } = await engineWith({
      ...xmlRoute,
      "GET /process-definition/statistics": {
        body: [
          statsRow("order", 1, { instances: 5 }),
          {
            id: LEASING,
            instances: 2,
            definition: { id: LEASING, key: "miraveloLeasing", name: null, version: 3 },
          },
        ],
      },
    })

    const data = await buildCockpitDashboardData(client, "engine-a")

    expect(data.definitions.map((d) => [d.key, d.name])).toEqual([
      ["order", "ORDER"],
      ["miraveloLeasing", "Miravelo - Bike Leasing"],
    ])
    expect(engine.requests.map((r) => r.path)).toEqual([
      "/process-definition/statistics",
      `/process-definition/${LEASING}/xml`,
    ])
  })

  it("in the definitions list", async () => {
    const { client } = await engineWith({
      ...xmlRoute,
      "GET /process-definition": {
        body: [
          { id: "order:1:d", key: "order", name: "Order", version: 1 },
          { id: LEASING, key: "miraveloLeasing", name: null, version: 3 },
        ],
      },
      "GET /process-definition/count": { body: { count: 2 } },
    })

    const data = await buildProcessListData(client, "engine-a", {})

    expect(data.definitions.map((d) => d.name)).toEqual(["Order", "Miravelo - Bike Leasing"])
  })

  it("in the instance list, its rows and its title", async () => {
    const { client } = await engineWith({
      ...xmlRoute,
      "POST /process-instance": {
        body: [{ id: "p1", definitionId: LEASING, businessKey: "LEA-1", suspended: false }],
      },
      "POST /process-instance/count": { body: { count: 1 } },
      "GET /process-definition": {
        body: [{ id: LEASING, key: "miraveloLeasing", name: null, version: 3 }],
      },
    })

    const all = await buildProcessInstancesData(client, "engine-a", {})
    const scoped = await buildProcessInstancesData(client, "engine-a", {
      processDefinitionKey: "miraveloLeasing",
    })

    expect(all.instances.map((i) => i.processDefinitionName)).toEqual(["Miravelo - Bike Leasing"])
    expect(scoped.processDefinitionName).toBe("Miravelo - Bike Leasing")
    expect(scoped.instances.map((i) => i.processDefinitionName)).toEqual([
      "Miravelo - Bike Leasing",
    ])
  })
})
