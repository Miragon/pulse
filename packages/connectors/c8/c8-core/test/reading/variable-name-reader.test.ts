import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { VariableNameReader } from "../../src/reading/variable-name-reader.js"
import { clientWith, page, type RestRoute } from "../support/fake-transport.js"
import { instance } from "../support/rows.js"

function readerWith(routes: readonly RestRoute[]) {
  const { camunda, client } = clientWith(routes)
  return { camunda, names: new VariableNameReader(client) }
}

describe("the variable names", () => {
  test("come sorted and once each from the newest instances", async () => {
    const { camunda, names } = readerWith([
      { route: "POST /process-instances/search", answer: page([instance("1"), instance("2")]) },
      {
        route: "POST /variables/search",
        answer: page(
          ["route", "amount", "route"].map((name) => ({
            name,
            value: "1",
            isTruncated: false,
            scopeKey: "1",
            processInstanceKey: "1",
          })),
        ),
      },
    ])

    expect(await names.read(DefinitionId("100"))).toEqual(["amount", "route"])
    expect(camunda.bodiesOf("POST /variables/search")[0]).toMatchObject({
      filter: { processInstanceKey: { $in: ["1", "2"] } },
    })
  })

  test("are none without instances or for an impossible key", async () => {
    const { names } = readerWith([{ route: "POST /process-instances/search", answer: page([]) }])

    expect(await names.read(DefinitionId("100"))).toEqual([])
    expect(await names.read(DefinitionId("a:1"))).toEqual([])
  })
})
