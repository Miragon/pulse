import { mount, type TestPanel } from "orca/testing"
import { afterEach, describe, expect, test } from "vitest"
import * as panel from "../../../src/panel/engines.js"
import { engineList, panelHost, sent, SHOP_DEV, SHOP_TEST, SIGN_IN_PROBLEM } from "./panel-host.js"

const TREE = { role: "tree" }
let view: TestPanel | undefined

async function mounted(host = panelHost()): Promise<TestPanel> {
  view = await mount(panel, { host })
  return view
}

function expectClean(panelView: TestPanel): void {
  expect(panelView.errors).toEqual([])
  expect(panelView.warnings).toEqual([])
  expect(panelView.refusals).toEqual([])
}

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

describe("the engines tree", () => {
  test("lists each engine with its definitions, the active one expanded", async () => {
    const shown = await mounted(panelHost({ "engines.list": engineList([SHOP_DEV, SHOP_TEST]) }))

    expect(shown.summary()).toContain('Tree "Engines": 2 top-level item(s)')
    expect(shown.find(TREE)?.text).toBe(
      "shop-dev (active) shop-test Order fulfillment Invoice No process definitions deployed",
    )
    expect(shown.expandedOf(TREE)).toEqual(["engine|shop-dev"])
    expect(shown.find({ type: "Text", text: "shop/.pulse-cli.json" })).not.toBeNull()
    expectClean(shown)
  })

  test("shows an engine's problem as its only child", async () => {
    const shown = await mounted(
      panelHost({
        "engines.list": engineList([{ ...SHOP_TEST, active: true, problem: SIGN_IN_PROBLEM }]),
      }),
    )

    expect(shown.find(TREE)?.text).toBe("shop-test (active) Sign in to shop-test.")
    expectClean(shown)
  })

  test("says when an engine has no process definitions deployed", async () => {
    const shown = await mounted(
      panelHost({ "engines.list": engineList([{ ...SHOP_DEV, definitions: [] }]) }),
    )

    expect(shown.find(TREE)?.text).toBe("shop-dev (active) No process definitions deployed")
  })

  test("shows the empty state and the default engine without engines", async () => {
    const shown = await mounted(panelHost({ "engines.list": engineList([], { projectFile: "" }) }))

    expect(shown.find(TREE)).toBeNull()
    expect(shown.summary().join("\n")).toContain("No engines")
    expect(shown.find({ type: "Text", text: "Default engine on localhost" })).not.toBeNull()
    expect(shown.find({ label: /^Go to a process instance/ })).toBeNull()
    expectClean(shown)
  })

  test("shows each configuration problem as a danger callout", async () => {
    const problems = [
      "/work/shop/.pulse-cli.json: profile prod needs a url",
      "/work/other/.pulse-cli.json: Pulse can't read this file",
    ]
    const shown = await mounted(panelHost({ "engines.list": engineList([SHOP_DEV], { problems }) }))

    expect(shown.summary()).toEqual(
      expect.arrayContaining(problems.map((problem) => `Callout danger "${problem}"`)),
    )
    expectClean(shown)
  })

  test("reloads the engines when the worker says they changed", async () => {
    let engines = [SHOP_DEV]
    const shown = await mounted(panelHost({ "engines.list": () => engineList(engines) }))
    engines = [SHOP_DEV, SHOP_TEST]

    await shown.post("engines.changed", { reason: "reload" })

    expect(shown.summary()).toContain('Tree "Engines": 2 top-level item(s)')
  })

  test("selects the key the worker focuses", async () => {
    const shown = await mounted()

    await shown.post("engines.focus", { key: "definition|shop-dev|order" })

    expect(shown.valueOf(TREE)).toBe("definition|shop-dev|order")
  })
})

describe("the engines tree's actions", () => {
  test("opens the engine overview on an engine", async () => {
    const host = panelHost({ "views.open": { path: "/work/shop/.pulse/shop-dev.pulse-view" } })
    const shown = await mounted(host)

    await shown.activateItem(TREE, "engine|shop-dev")

    expect(sent(host, "views.open")).toEqual([{ engine: "shop-dev", view: "engine" }])
    expectClean(shown)
  })

  test("opens the definition view on a definition", async () => {
    const host = panelHost({ "views.open": { path: "/work/shop/.pulse/order.pulse-view" } })
    const shown = await mounted(host)

    await shown.activateItem(TREE, "definition|shop-dev|order")

    expect(sent(host, "views.open")).toEqual([
      { engine: "shop-dev", view: "definition", bpmnProcessId: "order" },
    ])
  })

  test("switches the active engine from the select", async () => {
    const host = panelHost({
      "engines.list": engineList([SHOP_DEV, SHOP_TEST]),
      "engines.activate": { ok: true },
    })
    const shown = await mounted(host)

    expect(shown.valueOf({ label: "Active engine" })).toBe("shop-dev")
    await shown.select({ label: "Active engine" }, "shop-test")

    expect(sent(host, "engines.activate")).toEqual([{ engine: "shop-test" }])
    expectClean(shown)
  })

  test("offers no engine select for a single engine", async () => {
    const shown = await mounted()

    expect(shown.find({ label: "Active engine" })).toBeNull()
  })

  test("refreshes the engines and the files from the toolbar", async () => {
    const host = panelHost()
    const shown = await mounted(host)

    await shown.press({ label: "Refresh" })

    expect(sent(host, "engines.list")).toHaveLength(2)
    expect(sent(host, "boards.list")).toHaveLength(2)
    expect(sent(host, "models.list")).toHaveLength(2)
  })

  test("asks the worker to configure the engines from the toolbar", async () => {
    const host = panelHost({ "engines.configure": { path: "/work/shop/.pulse-cli.json" } })
    const shown = await mounted(host)

    await shown.press({ label: "Configure engines" })

    expect(sent(host, "engines.configure")).toEqual([undefined])
    expectClean(shown)
  })
})
