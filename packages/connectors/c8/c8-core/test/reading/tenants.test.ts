import { BpmnProcessId, DefinitionId, TenantId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { Tenants } from "../../src/mapping/tenants.js"
import { CalledProcessReader } from "../../src/reading/called-process-reader.js"
import { DefinitionReader } from "../../src/reading/definition-reader.js"
import { Diagrams } from "../../src/reading/diagrams.js"
import { clientWith, page, searchOf, type RestRoute } from "../support/fake-transport.js"
import { definition } from "../support/rows.js"

const DEFAULT = { tenantId: "<default>" }
const NORTH = { tenantId: "north" }

function counts(bpmnProcessId: string, tenantId: string, withIncident: number) {
  return {
    processDefinitionId: bpmnProcessId,
    tenantId,
    activeInstancesWithoutIncidentCount: 1,
    activeInstancesWithIncidentCount: withIncident,
  }
}

const INCIDENTS: RestRoute = {
  route: "POST /incidents/search",
  answer: (body: string) => page([], { totalItems: searchOf(body).filter.tenantId ? 2 : 1 }),
}

function clusterWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return {
    camunda,
    definitions: new DefinitionReader(client),
    calls: new CalledProcessReader(client, new Diagrams(client)),
  }
}

describe("a cluster with tenants", () => {
  test("names the default tenant as none, and every other by its id", () => {
    expect([Tenants.of("<default>"), Tenants.of(""), Tenants.of(undefined)]).toEqual([
      null,
      null,
      null,
    ])
    expect(Tenants.of("north")).toBe("north")
    expect([Tenants.clusterIdOf(null), Tenants.clusterIdOf(TenantId("north"))]).toEqual([
      "<default>",
      "north",
    ])
  })

  test("lists a key once per tenant with that tenant's counts and latest, its incidents by tenant", async () => {
    const { camunda, definitions } = clusterWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("10", "label", 1, DEFAULT),
          definition("21", "label", 3, NORTH),
          definition("30", "order", 1, DEFAULT),
        ]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances",
        answer: {
          items: [
            counts("label", "<default>", 0),
            counts("label", "north", 1),
            counts("order", "<default>", 1),
          ],
        },
      },
      INCIDENTS,
    ])

    const listed = await definitions.list()

    expect(
      listed.map(({ latest, running, withIncident, incidents }) => [
        latest.bpmnProcessId,
        latest.tenantId,
        latest.version,
        running,
        withIncident,
        incidents,
      ]),
    ).toEqual([
      ["label", null, 1, 1, 0, 0],
      ["label", "north", 3, 2, 1, 2],
      ["order", null, 1, 2, 1, 1],
    ])
    expect(
      camunda
        .bodiesOf("POST /incidents/search")
        .map((body) => (body as { filter: unknown }).filter),
    ).toEqual([
      { processDefinitionId: "label", tenantId: "north", state: "ACTIVE" },
      { processDefinitionId: "order", state: "ACTIVE" },
    ])
  })

  test("lists a process's versions in its tenant alone, the default tenant's as none", async () => {
    const { definitions } = clusterWith([
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("21", "label", 3, NORTH),
          definition("10", "label", 1, DEFAULT),
          definition("20", "label", 2, NORTH),
        ]),
      },
      {
        route: "POST /process-definitions/statistics/process-instances-by-version",
        answer: { items: [] },
      },
    ])
    const label = BpmnProcessId("label")

    const north = await definitions.versions(label, TenantId("north"))
    const none = await definitions.versions(label, null)

    expect(north.map(({ definition: ref }) => [ref.id, ref.tenantId])).toEqual([
      ["21", "north"],
      ["20", "north"],
    ])
    expect(none.map(({ definition: ref }) => [ref.id, ref.tenantId])).toEqual([["10", null]])
  })

  test("resolves a call in its caller's tenant, never another tenant's newer version", async () => {
    const { calls } = clusterWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:zeebe="z">
          <bpmn:callActivity id="Latest"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" />
          </bpmn:extensionElements></bpmn:callActivity>
          <bpmn:callActivity id="Tagged"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" bindingType="versionTag" versionTag="v1" />
          </bpmn:extensionElements></bpmn:callActivity>
        </bpmn:definitions>`,
      },
      {
        route: "POST /process-definitions/search",
        when: (body) => body.includes("isLatestVersion"),
        answer: page([definition("10", "label", 1, DEFAULT), definition("21", "label", 3, NORTH)]),
      },
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("21", "label", 3, { ...NORTH, versionTag: "v1" }),
          definition("10", "label", 1, { ...DEFAULT, versionTag: "v1" }),
        ]),
      },
    ])
    const described = async (tenantId: TenantId | null) =>
      (await calls.read({ id: DefinitionId("100"), tenantId })).map((call) => [
        call.elementId,
        call.tenantId,
        call.definition?.id,
      ])

    expect(await described(null)).toEqual([
      ["Latest", null, "10"],
      ["Tagged", null, "10"],
    ])
    expect(await described(TenantId("north"))).toEqual([
      ["Latest", "north", "21"],
      ["Tagged", "north", "21"],
    ])
  })
})
