import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { CalledProcessReader } from "../../src/reading/called-process-reader.js"
import { Diagrams } from "../../src/reading/diagrams.js"
import { clientWith, page, problem, type RestRoute } from "../support/fake-transport.js"
import { definition } from "../support/rows.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, reader: new CalledProcessReader(client, new Diagrams(client)) }
}

describe("the called processes", () => {
  const XML = `<bpmn:definitions xmlns:zeebe="z">
    <bpmn:callActivity id="Latest"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Tagged" name="a &gt; b"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="versionTag" versionTag="stable" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Untagged"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="versionTag" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Deployment"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="deployment" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="DeploymentTagged"><bpmn:extensionElements>
      <zeebe:calledElement processId="label" bindingType="deployment" versionTag="stable" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Unknown"><bpmn:extensionElements>
      <zeebe:calledElement processId="nothing" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Feel"><bpmn:extensionElements>
      <zeebe:calledElement processId="= target" />
    </bpmn:extensionElements></bpmn:callActivity>
    <bpmn:callActivity id="Bare" />
  </bpmn:definitions>`

  test("take the newest version where the search holds several latest ones of the caller's tenant", async () => {
    const { reader } = readerWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:zeebe="z">
          <bpmn:callActivity id="Latest"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" />
          </bpmn:extensionElements></bpmn:callActivity>
        </bpmn:definitions>`,
      },
      {
        route: "POST /process-definitions/search",
        answer: page([definition("20", "label", 2), definition("30", "label", 3)]),
      },
    ])

    const calls = await reader.read({ id: DefinitionId("100"), tenantId: null })

    expect(calls.map((call) => call.definition?.id)).toEqual(["30"])
  })

  test("resolve each binding, and leave out what only an expression decides", async () => {
    const { camunda, reader } = readerWith([
      { route: "GET /process-definitions/100/xml", answer: XML },
      {
        route: "POST /process-definitions/search",
        when: (body) => body.includes("isLatestVersion"),
        answer: page([definition("30", "label", 3)]),
      },
      {
        route: "POST /process-definitions/search",
        answer: page([
          definition("30", "label", 3),
          definition("20", "label", 2, { versionTag: "stable" }),
        ]),
      },
    ])

    const calls = await reader.read({ id: DefinitionId("100"), tenantId: null })

    expect(calls.map((call) => [call.elementId, call.bpmnProcessId, call.definition?.id])).toEqual([
      ["Latest", "label", "30"],
      ["Tagged", "label", "20"],
      ["Untagged", "label", undefined],
      ["Deployment", "label", undefined],
      ["DeploymentTagged", "label", undefined],
      ["Unknown", "nothing", undefined],
    ])
    expect(camunda.bodiesOf("POST /process-definitions/search")).toEqual([
      {
        filter: { processDefinitionId: { $in: ["label", "nothing"] }, isLatestVersion: true },
        page: { limit: 500 },
      },
      {
        filter: { processDefinitionId: "label", versionTag: "stable" },
        sort: [{ field: "version", order: "DESC" }],
        page: { limit: 500 },
      },
    ])
  })

  test("ask for the versions of a process with a tag once per tag, never for every version", async () => {
    const tagged = (id: string, tag: string) => `<bpmn:callActivity id="${id}">
      <bpmn:extensionElements>
        <zeebe:calledElement processId="label" bindingType="versionTag" versionTag="${tag}" />
      </bpmn:extensionElements></bpmn:callActivity>`
    const { camunda, reader } = readerWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:zeebe="z">
          ${tagged("First", "stable")}${tagged("Second", "stable")}${tagged("Third", "next")}
        </bpmn:definitions>`,
      },
      {
        route: "POST /process-definitions/search",
        when: (body) => body.includes('"versionTag":"stable"'),
        answer: page([
          definition("31", "label", 4, { versionTag: "stable", tenantId: "other" }),
          definition("30", "label", 3, { versionTag: "stable" }),
          definition("20", "label", 2, { versionTag: "stable" }),
        ]),
      },
      { route: "POST /process-definitions/search", answer: page([]) },
    ])

    const calls = await reader.read({ id: DefinitionId("100"), tenantId: null })

    expect(calls.map((call) => [call.elementId, call.definition?.id])).toEqual([
      ["First", "30"],
      ["Second", "30"],
      ["Third", undefined],
    ])
    expect(camunda.bodiesOf("POST /process-definitions/search")).toEqual([
      {
        filter: { processDefinitionId: "label", versionTag: "stable" },
        sort: [{ field: "version", order: "DESC" }],
        page: { limit: 500 },
      },
      {
        filter: { processDefinitionId: "label", versionTag: "next" },
        sort: [{ field: "version", order: "DESC" }],
        page: { limit: 500 },
      },
    ])
  })

  test("ask for the latest version of each process a call names once, never of every process", async () => {
    const { camunda, reader } = readerWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:zeebe="z">
          <bpmn:callActivity id="First"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" bindingType="latest" />
          </bpmn:extensionElements></bpmn:callActivity>
          <bpmn:callActivity id="Second"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" />
          </bpmn:extensionElements></bpmn:callActivity>
        </bpmn:definitions>`,
      },
      {
        route: "POST /process-definitions/search",
        answer: page([definition("30", "label", 3)]),
      },
    ])

    const calls = await reader.read({ id: DefinitionId("100"), tenantId: null })

    expect(calls.map((call) => [call.elementId, call.definition?.id])).toEqual([
      ["First", "30"],
      ["Second", "30"],
    ])
    expect(camunda.bodiesOf("POST /process-definitions/search")).toEqual([
      {
        filter: { processDefinitionId: { $in: ["label"] }, isLatestVersion: true },
        page: { limit: 500 },
      },
    ])
  })

  test("read no latest version where no call is bound to it", async () => {
    const { camunda, reader } = readerWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:definitions xmlns:zeebe="z">
          <bpmn:callActivity id="Deployment"><bpmn:extensionElements>
            <zeebe:calledElement processId="label" bindingType="deployment" />
          </bpmn:extensionElements></bpmn:callActivity>
          <bpmn:callActivity id="Feel"><bpmn:extensionElements>
            <zeebe:calledElement processId="= target" />
          </bpmn:extensionElements></bpmn:callActivity>
        </bpmn:definitions>`,
      },
    ])

    const calls = await reader.read({ id: DefinitionId("100"), tenantId: null })

    expect(calls.map((call) => [call.elementId, call.definition])).toEqual([
      ["Deployment", undefined],
    ])
    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /process-definitions/100/xml",
    ])
  })

  test("are none for a diagram without calls and for an unknown definition", async () => {
    const { reader } = readerWith([
      { route: "GET /process-definitions/100/xml", answer: "<definitions />" },
      {
        route: "GET /process-definitions/999/xml",
        answer: problem(404, "NOT_FOUND", "missing"),
      },
    ])

    expect(await reader.read({ id: DefinitionId("100"), tenantId: null })).toEqual([])
    expect(await reader.read({ id: DefinitionId("999"), tenantId: null })).toEqual([])
  })
})
