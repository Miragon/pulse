import { describe, expect, it } from "vitest"
import { definitionRefOf, definitionRefOfInstance } from "./definition-refs.js"

describe("definitionRefOf", () => {
  it("names the version by its id, its key as the process id, and its name", () => {
    expect(
      definitionRefOf({ id: "order:2:x", key: "order", version: 2, name: "Order fulfillment" }),
    ).toStrictEqual({
      id: "order:2:x",
      bpmnProcessId: "order",
      version: 2,
      name: "Order fulfillment",
    })
  })

  it("leaves the name out when the definition has none", () => {
    expect(definitionRefOf({ id: "order:2:x", key: "order", version: 2 })).toStrictEqual({
      id: "order:2:x",
      bpmnProcessId: "order",
      version: 2,
    })
  })
})

describe("definitionRefOfInstance", () => {
  const row = {
    id: "p1",
    processDefinitionId: "label:1:y",
    processDefinitionKey: "label",
    processDefinitionVersion: 1,
  }

  it("names the version an instance row runs on", () => {
    expect(definitionRefOfInstance({ ...row, processDefinitionName: "Print label" })).toStrictEqual(
      { id: "label:1:y", bpmnProcessId: "label", version: 1, name: "Print label" },
    )
  })

  it("leaves the name out when the row names none", () => {
    expect(definitionRefOfInstance(row)).toStrictEqual({
      id: "label:1:y",
      bpmnProcessId: "label",
      version: 1,
    })
  })
})
