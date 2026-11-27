import { describe, expect, it } from "vitest"
import { definitionRefOf, definitionRefOfInstance } from "./definition-refs.js"

describe("definitionRefOf", () => {
  it("names the version by its id, its key as the process id, and its name", () => {
    expect(
      definitionRefOf({ id: "order:2:x", key: "order", version: 2, name: "Order fulfillment" }),
    ).toStrictEqual({
      id: "order:2:x",
      bpmnProcessId: "order",
      tenantId: null,
      version: 2,
      name: "Order fulfillment",
    })
  })

  it("names the tenant the version is deployed in, an empty or null one as none", () => {
    const ref = (tenantId: string | null) =>
      definitionRefOf({ id: "order:2:x", key: "order", version: 2, tenantId }).tenantId
    expect([ref("acme"), ref(""), ref(null)]).toEqual(["acme", null, null])
  })

  it("leaves the name out when the definition has none", () => {
    expect(definitionRefOf({ id: "order:2:x", key: "order", version: 2 })).toStrictEqual({
      id: "order:2:x",
      bpmnProcessId: "order",
      tenantId: null,
      version: 2,
    })
  })
})

const ROW = {
  id: "p1",
  processDefinitionId: "label:1:y",
  processDefinitionKey: "label",
  processDefinitionVersion: 1,
}

describe("definitionRefOfInstance", () => {
  const row = ROW

  it("names the version an instance row runs on", () => {
    expect(
      definitionRefOfInstance({ ...row, processDefinitionName: "Print label" }, new Map()),
    ).toStrictEqual({
      id: "label:1:y",
      bpmnProcessId: "label",
      tenantId: null,
      version: 1,
      name: "Print label",
    })
  })

  it("leaves the name out when the row names none", () => {
    expect(definitionRefOfInstance(row, new Map())).toStrictEqual({
      id: "label:1:y",
      bpmnProcessId: "label",
      tenantId: null,
      version: 1,
    })
  })

  it("names the version's tenant, never the instance's: a shared definition runs a tenant's instances", () => {
    const shared = { ...row, tenantId: "acme" }
    expect(definitionRefOfInstance(shared, new Map([["label:1:y", null]])).tenantId).toBeNull()
    expect(definitionRefOfInstance(shared, new Map()).tenantId).toBeNull()
    const deployed = new Map([["label:1:y", "acme"]])
    expect(definitionRefOfInstance(shared, deployed).tenantId).toBe("acme")
  })
})
