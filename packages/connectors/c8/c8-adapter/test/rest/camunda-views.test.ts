import { describe, expect, test } from "vitest"
import { UnexpectedAnswerError } from "../../src/rest/index.js"
import { clientWith, page, TOPOLOGY } from "../support/fake-camunda-rest.js"
import { definition, instance } from "../support/rows.js"

describe("the checked views of a cluster's answers", () => {
  test.each([
    ["an answer that is no object", ["many"], "topology is not an object"],
    ["a missing field", {}, "gatewayVersion is missing"],
    ["a field of another type", { gatewayVersion: 8 }, "gatewayVersion is not a string"],
  ])("refuse %s as unexpected", async (_name, answer, message) => {
    const { client } = clientWith([{ route: "GET /topology", answer }])

    const read = client.topology()

    await expect(read).rejects.toBeInstanceOf(UnexpectedAnswerError)
    await expect(read).rejects.toMatchObject({ message })
  })

  test.each([
    ["a search without items", { page: {} }, "/process-instances/search holds no list of items"],
    ["a search without a page", { items: [] }, "page is not an object"],
    ["a row that is no object", page([7]), "/process-instances/search[0] is not an object"],
    ["a count of another type", page([], { totalItems: "many" }), "totalItems is not a number"],
    [
      "a number field of another type",
      page([instance("7", { processDefinitionVersion: "1" })]),
      "processDefinitionVersion is not a number",
    ],
    [
      "a missing number",
      page([instance("7", { processDefinitionVersion: null })]),
      "processDefinitionVersion is missing",
    ],
  ])("refuse %s in a search", async (_name, answer, message) => {
    const { client } = clientWith([{ route: "POST /process-instances/search", answer }])

    await expect(client.instances({}, { limit: 1 })).rejects.toMatchObject({
      name: "UnexpectedAnswerError",
      message,
    })
  })

  test("leave out what an answer does not hold, and read a missing flag as false", async () => {
    const { client } = clientWith([
      TOPOLOGY,
      {
        route: "POST /process-instances/search",
        answer: page([
          {
            processInstanceKey: "7",
            processDefinitionKey: "100",
            processDefinitionId: "order",
            processDefinitionVersion: 1,
            state: "ACTIVE",
            endDate: null,
          },
        ]),
      },
      {
        route: "POST /process-definitions/search",
        answer: page([{ processDefinitionKey: "1", processDefinitionId: "order", version: 1 }]),
      },
    ])

    expect((await client.instances({}, { limit: 1 })).items).toEqual([
      {
        key: "7",
        definitionKey: "100",
        bpmnProcessId: "order",
        version: 1,
        state: "ACTIVE",
        hasIncident: false,
      },
    ])
    expect(await client.latestDefinitions()).toEqual([
      { key: "1", bpmnProcessId: "order", version: 1 },
    ])
    expect((await client.topology()).gatewayVersion).toBe("8.10.8")
  })

  test("read an answer that is no JSON as unexpected", async () => {
    const { client } = clientWith([
      {
        route: "POST /process-definitions/search",
        answer: new Response("<html>gateway</html>", { headers: { "Content-Type": "text/html" } }),
      },
    ])

    await expect(client.latestDefinitions()).rejects.toMatchObject({
      name: "UnexpectedAnswerError",
      message: expect.stringContaining("the cluster answered no JSON") as unknown,
    })
  })

  test("keep the definition's name, version tag and state when present", async () => {
    const { client } = clientWith([
      {
        route: "GET /process-definitions/1",
        answer: definition("1", "order", 2, { versionTag: "release-2", state: null }),
      },
    ])

    expect(await client.definition("1")).toEqual({
      key: "1",
      bpmnProcessId: "order",
      version: 2,
      name: "order name",
      versionTag: "release-2",
    })
  })

  test("fail a lookup whose answer has another shape, never reading it as missing", async () => {
    const { client } = clientWith([{ route: "GET /incidents/9", answer: { incidentKey: 9 } }])

    await expect(client.incident("9")).rejects.toMatchObject({
      name: "UnexpectedAnswerError",
      message: "incidentKey is not a string",
    })
  })
})
