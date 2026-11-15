import { DefinitionId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import { VariableNameReader } from "./variable-name-reader.js"

const INSTANCE = {
  processDefinitionId: "order:1:a",
  processDefinitionKey: "order",
  processDefinitionVersion: 1,
  state: "ACTIVE",
}

describe("VariableNameReader.names", () => {
  it("names the variables of the newest instances of a version once each, sorted by code unit", async () => {
    const port = fakePort({
      queryHistoricProcessInstances: () => [
        { ...INSTANCE, id: "p1" },
        { ...INSTANCE, id: "p2" },
      ],
      queryHistoricVariableInstances: () =>
        ["route", "amount", "route", "Zone", "reviewNote"].map((name) => ({
          name,
          type: "String",
        })),
    })

    expect(await new VariableNameReader(port).names(DefinitionId("order:1:a"))).toStrictEqual([
      "Zone",
      "amount",
      "reviewNote",
      "route",
    ])
    expect(port.calls.map((call) => call.input)).toStrictEqual([
      {
        pathArgs: [],
        query: { firstResult: "0", maxResults: "50" },
        body: {
          processDefinitionId: "order:1:a",
          sorting: [
            { sortBy: "startTime", sortOrder: "desc" },
            { sortBy: "instanceId", sortOrder: "asc" },
          ],
        },
      },
      {
        pathArgs: [],
        query: { deserializeValues: "false", maxResults: "2000" },
        body: { processInstanceIdIn: ["p1", "p2"] },
      },
    ])
    expect(Object.keys(port.calls[1]?.input.query ?? {})).toStrictEqual([
      "deserializeValues",
      "maxResults",
    ])
  })

  it("asks for no variables when the version has no instances", async () => {
    const port = fakePort({ queryHistoricProcessInstances: () => [] })

    expect(await new VariableNameReader(port).names(DefinitionId("order:9"))).toStrictEqual([])
    expect(port.calls).toHaveLength(1)
  })

  it.each([
    ["no list", {}, "historic variable instances is not a list"],
    ["a variable without its name", [{ type: "String" }], "name is missing"],
  ])("fails an answer with %s", async (_name, answer, message) => {
    const port = fakePort({
      queryHistoricProcessInstances: () => [{ ...INSTANCE, id: "p1" }],
      queryHistoricVariableInstances: () => answer,
    })

    const error = await new VariableNameReader(port).names(DefinitionId("order:1:a")).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })
})
