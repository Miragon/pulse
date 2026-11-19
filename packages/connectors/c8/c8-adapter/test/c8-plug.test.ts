import { describe, expect, test } from "vitest"
import { C8BpmnDialect } from "../src/c8-bpmn-dialect.js"
import { C8Adapter } from "../src/index.js"
import { REST_URL, runtimeWith, TOPOLOGY } from "./support/fake-camunda-rest.js"

describe("the plug of the C8 adapter", () => {
  test("builds a runtime per connection that reads the cluster over the adapter's wire", async () => {
    const { camunda, runtime } = runtimeWith([TOPOLOGY])

    expect(await runtime.describeEngine()).toEqual({ product: "Camunda 8", version: "8.10.8" })
    expect(camunda.requests).toEqual([
      expect.objectContaining({ route: "GET /topology", accept: "application/json" }),
    ])
  })

  test("words the runtime's failures as its wire does", async () => {
    const { runtime } = runtimeWith([
      { route: "GET /topology", answer: new Response("", { status: 401 }) },
    ])

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      name: "RuntimeError",
      failure: "unauthorized",
      message: "HTTP 401 Unauthorized",
      hint: "The cluster asks for a login, and Pulse sent none. Add one with Set credentials.",
    })
  })

  test("offers no writes and no command line for a cluster", () => {
    const adapter = new C8Adapter()

    expect(adapter.commands()).toBeUndefined()
    expect(adapter.cli()).toBeUndefined()
  })

  test("links into Operate, never into the cluster's REST root", () => {
    const adapter = new C8Adapter()

    expect(adapter.webUi("https://camunda.test/operate")?.name).toBe("Operate")
    expect(adapter.webUi(REST_URL)).toBeUndefined()
  })

  test("reads Camunda 8's BPMN in its own dialect", () => {
    expect(new C8Adapter().bpmn).toBeInstanceOf(C8BpmnDialect)
  })
})
