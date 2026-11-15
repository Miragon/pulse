import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { Diagrams } from "../../src/reading/diagrams.js"
import { clientWith, problem, type RestRoute } from "../support/fake-camunda-rest.js"

function diagramsWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, diagrams: new Diagrams(client) }
}

describe("the diagrams", () => {
  test("read a diagram once and treat a missing one and an impossible key as none", async () => {
    const { camunda, diagrams } = diagramsWith([
      {
        route: "GET /process-definitions/100/xml",
        answer: new Response("<definitions />", { headers: { "Content-Type": "text/xml" } }),
      },
      {
        route: "GET /process-definitions/999/xml",
        answer: problem(404, "NOT_FOUND", "Process Definition with key '999' not found"),
      },
    ])

    expect(await diagrams.xml(DefinitionId("100"))).toBe("<definitions />")
    expect(await diagrams.xml(DefinitionId("100"))).toBe("<definitions />")
    expect(await diagrams.xml(DefinitionId("999"))).toBeUndefined()
    expect(await diagrams.xml(DefinitionId("999"))).toBeUndefined()
    expect(await diagrams.xml(DefinitionId("order:1"))).toBeUndefined()

    expect(camunda.requests.map((request) => request.route)).toEqual([
      "GET /process-definitions/100/xml",
      "GET /process-definitions/999/xml",
      "GET /process-definitions/999/xml",
    ])
  })

  test.each([["9223372036854775807"], ["-9223372036854775808"], ["0"]])(
    "read the diagram of %s, a key within a Java long",
    async (key) => {
      const { camunda, diagrams } = diagramsWith([
        { route: `GET /process-definitions/${key}/xml`, answer: new Response("<definitions />") },
      ])

      expect(await diagrams.xml(DefinitionId(key))).toBe("<definitions />")
      expect(camunda.requests).toHaveLength(1)
    },
  )

  test.each([
    ["9223372036854775808"],
    ["-9223372036854775809"],
    ["9999999999999999999"],
    ["12345678901234567890"],
    ["+1"],
    ["1 "],
    [""],
  ])("treat %j, which is no Java long, as no key and send no call for it", async (key) => {
    const { camunda, diagrams } = diagramsWith([])

    expect(await diagrams.xml(DefinitionId(key))).toBeUndefined()
    expect(camunda.requests).toEqual([])
  })
})
