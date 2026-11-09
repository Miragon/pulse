import { mount, type MockHost, type TestPanel } from "orca/testing"
import { afterEach, describe, expect, test } from "vitest"
import * as panel from "../../../src/panel/engines.js"
import type { FileRow, FoundInstance } from "../../../src/protocol.js"
import { panelHost, sent } from "./panel-host.js"

const SEARCH = { label: "Go to a process instance on shop-dev" }
const ORDER_4711: FoundInstance = {
  instanceId: "a1b2",
  label: "order-4711",
  description: "Order fulfillment · active",
}
const ORDER_4712: FoundInstance = {
  instanceId: "c3d4",
  label: "order-4712",
  description: "Order fulfillment · ended",
}
const REVIEW: FileRow = {
  path: "/work/shop/boards/review.board.json",
  label: "Review",
  description: "boards/review.board.json",
}
let view: TestPanel | undefined

async function mounted(host: MockHost): Promise<TestPanel> {
  view = await mount(panel, { host })
  return view
}

function finding(found: readonly FoundInstance[]): MockHost {
  return panelHost({
    "instances.find": { found },
    "views.open": { path: "/work/shop/.pulse/instance.pulse-view" },
  })
}

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

describe("go to a process instance", () => {
  test("opens the one instance it finds", async () => {
    const host = finding([ORDER_4711])
    const shown = await mounted(host)

    await shown.type(SEARCH, "  order-4711 ", { submit: true })

    expect(sent(host, "instances.find")).toEqual([{ query: "order-4711" }])
    expect(sent(host, "views.open")).toEqual([
      { engine: "shop-dev", view: "instance", instanceId: "a1b2" },
    ])
    expect(shown.refusals).toEqual([])
  })

  test("lists several matches and opens the pressed one", async () => {
    const host = finding([ORDER_4711, ORDER_4712])
    const shown = await mounted(host)

    await shown.type(SEARCH, "order-47", { submit: true })
    expect(shown.find({ label: "2 instances" })?.text).toContain("order-4712")
    await shown.press({ label: "order-4712" })

    expect(sent(host, "views.open")).toEqual([
      { engine: "shop-dev", view: "instance", instanceId: "c3d4" },
    ])
    expect(shown.find({ label: "2 instances" })).toBeNull()
  })

  test("says when nothing matches", async () => {
    const host = finding([])
    const shown = await mounted(host)

    await shown.type(SEARCH, "order-9999", { submit: true })

    expect(
      shown.find({ text: 'No instance with the ID or business key "order-9999" on shop-dev.' }),
    ).not.toBeNull()
    expect(sent(host, "views.open")).toEqual([])
  })

  test("does not search for blank text", async () => {
    const host = finding([])
    const shown = await mounted(host)

    await shown.type(SEARCH, "   ", { submit: true })

    expect(sent(host, "instances.find")).toEqual([])
  })
})

describe("the boards", () => {
  test("say when the project has none", async () => {
    const shown = await mounted(panelHost())

    await shown.toggle({ label: "Boards" })

    expect(shown.find({ text: "No boards yet." })).not.toBeNull()
  })

  test("open the pressed board", async () => {
    const host = panelHost({ "boards.list": { boards: [REVIEW] }, "boards.open": { ok: true } })
    const shown = await mounted(host)

    await shown.toggle({ label: "Boards" })
    await shown.press({ label: "Review" })

    expect(sent(host, "boards.open")).toEqual([{ path: REVIEW.path }])
    expect(shown.refusals).toEqual([])
  })

  test("create a board with the typed title and list it", async () => {
    let boards: readonly FileRow[] = []
    const host = panelHost({
      "boards.list": () => ({ boards }),
      "boards.create": () => {
        boards = [REVIEW]
        return { path: REVIEW.path }
      },
    })
    const shown = await mounted(host)
    await shown.toggle({ label: "Boards" })

    await shown.type({ label: "New board" }, " Review ")
    await shown.press({ role: "button", text: "New board" })

    expect(sent(host, "boards.create")).toEqual([{ title: "Review" }])
    expect(shown.valueOf({ label: "New board" })).toBe("")
    expect(shown.find({ label: "Review" })).not.toBeNull()
    expect(shown.errors).toEqual([])
  })

  test("create no board without a title", async () => {
    const host = panelHost({ "boards.create": { path: REVIEW.path } })
    const shown = await mounted(host)
    await shown.toggle({ label: "Boards" })

    await shown.press({ role: "button", text: "New board" })

    expect(sent(host, "boards.create")).toEqual([])
  })
})

describe("the local models", () => {
  test("say when the project has no .bpmn files", async () => {
    const shown = await mounted(panelHost())

    await shown.toggle({ label: "Local models" })

    expect(shown.find({ text: "No .bpmn files in this project." })).not.toBeNull()
  })

  test("open the runtime data of a model on the active engine", async () => {
    const model = {
      path: "/work/shop/src/order.bpmn",
      label: "Order fulfillment",
      description: "src/order.bpmn",
      bpmnProcessId: "order",
    }
    const host = panelHost({
      "models.list": { models: [model] },
      "views.open": { path: "/work/shop/.pulse/order.pulse-view" },
    })
    const shown = await mounted(host)

    await shown.toggle({ label: "Local models" })
    await shown.press({ label: "Order fulfillment" })

    expect(sent(host, "views.open")).toEqual([
      { engine: "shop-dev", view: "model", bpmnProcessId: "order", modelPath: model.path },
    ])
  })
})
