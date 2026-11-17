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

  test("take the newest version when tenants hold several latest ones", async () => {
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

    const calls = await reader.read(DefinitionId("100"))

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

    const calls = await reader.read(DefinitionId("100"))

    expect(calls.map((call) => [call.elementId, call.bpmnProcessId, call.definition?.id])).toEqual([
      ["Latest", "label", "30"],
      ["Tagged", "label", "20"],
      ["Untagged", "label", undefined],
      ["Deployment", "label", undefined],
      ["DeploymentTagged", "label", undefined],
      ["Unknown", "nothing", undefined],
    ])
    expect(
      camunda
        .bodiesOf("POST /process-definitions/search")
        .filter((body) => JSON.stringify(body).includes("processDefinitionId")),
    ).toHaveLength(1)
  })

  test("are none for a diagram without calls and for an unknown definition", async () => {
    const { reader } = readerWith([
      { route: "GET /process-definitions/100/xml", answer: "<definitions />" },
      {
        route: "GET /process-definitions/999/xml",
        answer: problem(404, "NOT_FOUND", "missing"),
      },
    ])

    expect(await reader.read(DefinitionId("100"))).toEqual([])
    expect(await reader.read(DefinitionId("999"))).toEqual([])
  })
})
