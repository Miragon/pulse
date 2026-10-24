import {
  BpmnProcessId,
  type EngineInfo,
  type ProcessCommands,
  type ProcessRuntime,
} from "../../src/contract/index.js"
import { FakeEngine, FakeWorld, PatchedRuntime } from "../../src/contract/fake/index.js"
import { DiagramCache } from "../../src/core/index.js"
import { ConnectionLive } from "./support/connection-live.js"
import { describe, expect, test, vi } from "vitest"
import type { Connection } from "../../src/host/connections/connection.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { EnginesTree, type EnginesTreeNode } from "../../src/host/explorer/engines-tree.js"
import { FakeRegistry } from "./support/fake-registry.js"
import { TreeItemCollapsibleState, treeViews } from "./support/vscode-fake.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

const ENGINE: EngineInfo = { product: "Operaton", version: "1.0.0" }

function engineAnswering(describe: () => Promise<EngineInfo>): ProcessRuntime {
  return new PatchedRuntime(new FakeEngine(FakeWorld.seed().state), {
    describeEngine: describe,
  })
}

function connection(runtime: ProcessRuntime, commands?: ProcessCommands): Connection {
  return {
    target: { ...LOCAL_TARGET, name: "local-operaton" },
    badge: { name: "local-operaton", environment: "local", host: "localhost:8080" },
    runtime,
    diagrams: new DiagramCache(runtime),
    ...ConnectionLive.of(runtime),
    ...(commands === undefined ? {} : { commands }),
  }
}

function treeOf(registry: FakeRegistry) {
  const tree = new EnginesTree(registry.asRegistry())
  const view = treeViews.at(-1)!
  const changedNodes: EnginesTreeNode[] = []
  tree.onDidChangeTreeData((node) => {
    if (node !== undefined) {
      changedNodes.push(node)
    }
  })
  return { tree, view, changedNodes }
}

async function firstEngine(tree: EnginesTree): Promise<EnginesTreeNode> {
  const [engine] = await tree.getChildren()
  if (engine?.kind !== "engine") {
    throw new Error("expected an engine on top")
  }
  return engine
}

describe("the product name of an engine in the Engines tree", () => {
  test("appears on the node the tree shows once the engine has described itself", async () => {
    const registry = new FakeRegistry([connection(engineAnswering(() => Promise.resolve(ENGINE)))])
    const { tree, changedNodes } = treeOf(registry)
    const engine = await firstEngine(tree)
    expect(tree.getTreeItem(engine).description).toBe("LOCAL · localhost:8080")

    await tree.getChildren(engine)

    await vi.waitFor(() => {
      expect(changedNodes).toHaveLength(1)
    })
    expect(changedNodes[0]).toBe(engine)
    expect(await firstEngine(tree)).toBe(engine)
    expect(tree.getTreeItem(engine).description).toBe("LOCAL · Operaton 1.0.0")
  })

  test("stays when Set Credentials or Refresh reload the connections", async () => {
    const registry = new FakeRegistry([connection(engineAnswering(() => Promise.resolve(ENGINE)))])
    const { tree, changedNodes } = treeOf(registry)
    await tree.getChildren(await firstEngine(tree))
    await vi.waitFor(() => {
      expect(changedNodes).toHaveLength(1)
    })

    registry.reload([connection(engineAnswering(() => new Promise(() => undefined)))])
    const reloaded = await firstEngine(tree)

    expect(tree.getTreeItem(reloaded).description).toBe("LOCAL · Operaton 1.0.0")
  })

  test("refreshes the reloaded node when the answer arrives after a reload", async () => {
    let answer: (engine: EngineInfo) => void = () => undefined
    const slow = engineAnswering(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const registry = new FakeRegistry([connection(slow)])
    const { tree, changedNodes } = treeOf(registry)
    await tree.getChildren(await firstEngine(tree))

    registry.reload([connection(slow)])
    const reloaded = await firstEngine(tree)
    answer(ENGINE)

    await vi.waitFor(() => {
      expect(changedNodes).toEqual([reloaded])
    })
    expect(changedNodes[0]).toBe(reloaded)
    expect(tree.getTreeItem(reloaded).description).toBe("LOCAL · Operaton 1.0.0")
  })
})

describe("the access of an engine in the Engines tree", () => {
  test.each([
    ["writable", {} as ProcessCommands],
    ["read-only", undefined],
  ])("says %s in tooltip and accessibility label, as the panel does", async (access, commands) => {
    const runtime = engineAnswering(() => Promise.resolve(ENGINE))
    const { tree } = treeOf(new FakeRegistry([connection(runtime, commands)]))

    const item = tree.getTreeItem(await firstEngine(tree))

    expect(item.tooltip).toBe(`local-operaton · http://localhost:8080/engine-rest · ${access}`)
    expect(item.accessibilityInformation?.label).toBe(
      `local-operaton, LOCAL · localhost:8080, ${access} engine`,
    )
  })
})

describe("a click on an engine in the Engines tree", () => {
  test("opens the overview of that engine and leaves expanding to the twistie", async () => {
    const runtime = engineAnswering(() => Promise.resolve(ENGINE))
    const { tree } = treeOf(new FakeRegistry([connection(runtime)]))

    const item = tree.getTreeItem(await firstEngine(tree))

    expect(item.command).toEqual({
      command: "pulse.openEngineOverview",
      title: "Open Engine Overview",
      arguments: ["local-operaton"],
    })
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded)
  })
})

describe("the Engines tree following the active panel", () => {
  const ORDER = BpmnProcessId("pulse-order")

  test("selects the process of an active definition panel below its engine", async () => {
    const { tree, view } = treeOf(
      new FakeRegistry([connection(engineAnswering(() => Promise.resolve(ENGINE)))]),
    )

    await tree.reveal({ engineName: "local-operaton", bpmnProcessId: ORDER })

    const [revealed] = view.revealed
    const node = revealed?.element as EnginesTreeNode
    expect(node.kind === "definition" && node.node.bpmnProcessId).toBe(ORDER)
    expect(revealed?.options).toEqual({ select: true, focus: false })
    expect(tree.getParent(node)).toBe(await firstEngine(tree))
    expect(tree.getTreeItem(node).id).toBe("definition|local-operaton|pulse-order")
  })

  test("selects the engine of an active engine overview", async () => {
    const { tree, view } = treeOf(
      new FakeRegistry([connection(engineAnswering(() => Promise.resolve(ENGINE)))]),
    )

    await tree.reveal({ engineName: "local-operaton" })

    expect(view.revealed.map(({ element }) => element)).toEqual([await firstEngine(tree)])
  })

  test("leaves a hidden view and an unknown engine alone", async () => {
    const { tree, view } = treeOf(
      new FakeRegistry([connection(engineAnswering(() => Promise.resolve(ENGINE)))]),
    )

    await tree.reveal({ engineName: "elsewhere", bpmnProcessId: ORDER })
    view.visible = false
    await tree.reveal({ engineName: "local-operaton", bpmnProcessId: ORDER })

    expect(view.revealed).toEqual([])
  })
})
