import { BpmnProcessId } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { DiagramCache, EngineLane, MigrationPlanPanel } from "@miragon/pulse-runtime-view/core"
import {
  type Connection,
  ConnectionBuilder,
  type EngineTarget,
  WriteAudit,
} from "@miragon/pulse-runtime-view/host-kit"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type * as vscode from "vscode"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import { PreviewMigrationPlanCommand } from "../../src/host/commands/preview-migration-plan-command.js"
import { CompositionRoot } from "../../src/host/composition-root.js"
import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import { LiveWiring } from "../../src/host/live/live-wiring.js"
import { WindowAttention } from "../../src/host/live/window-attention.js"
import { PanelManager } from "../../src/host/panels/panel-manager.js"
import type { PanelHost } from "../../src/host/panels/vscode-panel-effects.js"
import { ConnectionLive } from "./support/connection-live.js"
import { FakeRegistry } from "./support/fake-registry.js"
import { LOCAL_TARGET } from "./support/local-target.js"
import { TabInputCustom, TabInputText, Uri, informed, tabGroups } from "./support/vscode-fake.js"

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  panels: [] as {
    title: string
    revealed: number
    disposed: boolean
    send: (message: unknown) => void
  }[],
}))

vi.mock("vscode", async () => {
  const actual = await import("./support/vscode-fake.js")
  const NOTHING = { dispose: () => undefined }
  const missing = () => Promise.reject(new Error("missing"))
  const createWebviewPanel = (_type: string, title: string) => {
    const received = new actual.EventEmitter<unknown>()
    const disposed = new actual.EventEmitter<undefined>()
    const panel = {
      title,
      revealed: 0,
      disposed: false,
      visible: false,
      active: false,
      webview: {
        html: "",
        cspSource: "vscode-resource:",
        asWebviewUri: (uri: unknown) => uri,
        postMessage: () => Promise.resolve(true),
        onDidReceiveMessage: received.event,
      },
      onDidChangeViewState: () => NOTHING,
      onDidDispose: disposed.event,
      reveal: () => {
        panel.revealed += 1
      },
      dispose: () => {
        panel.disposed = true
        disposed.fire(undefined)
      },
      send: (message: unknown) => {
        received.fire(message)
      },
    }
    fake.panels.push(panel)
    return panel
  }
  return {
    ...actual,
    window: { ...actual.window, createWebviewPanel },
    workspace: {
      ...actual.workspace,
      fs: {
        stat: ({ path }: { readonly path: string }) => {
          const text = fake.files.get(path)
          return text === undefined ? missing() : Promise.resolve({ size: text.length })
        },
        readFile: ({ path }: { readonly path: string }) => {
          const text = fake.files.get(path)
          return text === undefined ? missing() : Promise.resolve(new TextEncoder().encode(text))
        },
      },
    },
  }
})

vi.mock("@miragon/modeler-shell/vscode/extension", () => ({
  connectThemeBridge: () => ({ dispose: () => undefined }),
  currentAppearance: () => ({}),
  renderWebviewHtml: () => "<html></html>",
}))

const PLAN = "/w/.pulse/migrations/order-v1-to-v2.migration.json"

const PLAN_TEXT = JSON.stringify({
  bpmnProcessId: "order",
  source: { version: 1 },
  target: { version: 2 },
  mappings: [],
})

function planUri(path = PLAN): vscode.Uri {
  return Uri.file(path) as unknown as vscode.Uri
}

const ENGINES = CompositionRoot.create().engines

function built(target: EngineTarget): Connection {
  return new ConnectionBuilder(
    ENGINES,
    new WriteAudit({ info: () => undefined }),
    VSCODE_WRITES_WORDING,
  ).build(target, { kind: "none" }, "local", {
    writes: "localOnly",
    live: undefined,
    lane: new EngineLane(),
  })
}

const LOCAL = built(LOCAL_TARGET)
const SHOP_TEST = built({ ...LOCAL_TARGET, name: "shop-test" })
const CLUSTER = built({
  ...LOCAL_TARGET,
  name: "cluster",
  engine: "c8",
  endpoint: "http://localhost:8088/v2",
})
const SHOP_SSO = built({ ...LOCAL_TARGET, name: "shop-sso", auth: { kind: "oauth2" } })
const SHOP_LEGACY = built({ ...LOCAL_TARGET, name: "shop-legacy", auth: { kind: "oauth2" } })
const CLUSTER_SSO = built({
  ...LOCAL_TARGET,
  name: "cluster-sso",
  engine: "c8",
  endpoint: "http://cluster.example.com/v2",
  auth: { kind: "basic" },
})

function previewOf(connections: readonly Connection[], picked?: Connection) {
  const pick = vi.fn<ConnectionPicker["pick"]>(() => Promise.resolve(picked))
  const openMigrationPlan = vi.fn<PanelManager["openMigrationPlan"]>()
  const command = new PreviewMigrationPlanCommand(
    new FakeRegistry(connections).asRegistry(),
    { pick } as unknown as ConnectionPicker,
    { openMigrationPlan },
    ENGINES,
  )
  return { command, pick, openMigrationPlan }
}

function fakeConnection(name: string): Connection {
  const runtime = new FakeEngine(FakeWorld.seed().state)
  return {
    target: { ...LOCAL_TARGET, name },
    badge: { name, environment: "local", host: "localhost:8080" },
    runtime,
    diagrams: new DiagramCache(runtime),
    ...ConnectionLive.of(runtime),
  }
}

function managerOf(connections: readonly Connection[]) {
  const registry = new FakeRegistry(connections)
  const attention = new WindowAttention()
  const manager = new PanelManager(
    Uri.file("/extension") as unknown as vscode.Uri,
    { registry: registry.asRegistry() } as unknown as PanelHost,
    new LiveWiring(attention, () => undefined),
  )
  const close = () => {
    manager.dispose()
    attention.dispose()
  }
  return { manager, registry, close }
}

beforeEach(() => {
  fake.files.clear()
  fake.panels.length = 0
  informed.length = 0
  delete tabGroups.activeTabGroup.activeTab
})

describe("Preview Migration Plan", () => {
  test("previews the plan file it is given, else the one in the active tab", async () => {
    const { command, openMigrationPlan } = previewOf([LOCAL])
    const other = planUri("/w/plans/invoice.migration.json")

    await command.run(planUri())
    tabGroups.activeTabGroup.activeTab = { input: new TabInputText(Uri.file(other.path)) }
    await command.run()
    tabGroups.activeTabGroup.activeTab = {
      input: new TabInputCustom(Uri.file(PLAN), "bpmn-modeler.bpmn"),
    }
    await command.run("not a file")

    expect(openMigrationPlan.mock.calls.map(([engine, file]) => [engine, file.path])).toEqual([
      [LOCAL, PLAN],
      [LOCAL, other.path],
      [LOCAL, PLAN],
    ])
    expect(informed).toEqual([])
  })

  test("asks for a plan file when none is open or the file is no plan", async () => {
    const { command, pick, openMigrationPlan } = previewOf([LOCAL, SHOP_TEST])

    await command.run()
    await command.run(planUri("/w/.pulse/boards/payments.board.json"))
    tabGroups.activeTabGroup.activeTab = { input: new TabInputText(Uri.file("/w/.migration.json")) }
    await command.run()

    expect(informed).toEqual(
      Array(3).fill("Open a migration plan file (.migration.json) to preview it."),
    )
    expect(pick).not.toHaveBeenCalled()
    expect(openMigrationPlan).not.toHaveBeenCalled()
  })

  test("says so when no engine checks migration plans, and offers none that doesn't or is refused", async () => {
    const none = previewOf([CLUSTER, CLUSTER_SSO])
    const one = previewOf([CLUSTER, SHOP_SSO, LOCAL])

    await none.command.run(planUri())
    await one.command.run(planUri())

    expect("checkMigration" in CLUSTER.runtime).toBe(false)
    expect("checkMigration" in CLUSTER_SSO.runtime).toBe(true)
    expect("checkMigration" in SHOP_SSO.runtime).toBe(true)
    expect(informed).toEqual([
      "None of the configured engines checks migration plans, so Pulse can't preview one.",
    ])
    expect(none.openMigrationPlan).not.toHaveBeenCalled()
    expect(one.pick).not.toHaveBeenCalled()
    expect(one.openMigrationPlan.mock.calls.map(([engine]) => engine)).toEqual([LOCAL])
  })

  test("names the engines that check plans when Pulse refuses the connection to each of them", async () => {
    const one = previewOf([SHOP_SSO])
    const two = previewOf([CLUSTER, SHOP_SSO, SHOP_LEGACY])

    await one.command.run(planUri())
    await two.command.run(planUri())

    expect(informed).toEqual([
      "Pulse refuses the connection to shop-sso, so it can't preview a plan there. Expand shop-sso in the Engines view to see why and what to change.",
      "Pulse refuses the connections to shop-sso and shop-legacy, so it can't preview a plan there. Expand them in the Engines view to see why and what to change.",
    ])
    expect(one.openMigrationPlan).not.toHaveBeenCalled()
    expect(two.pick).not.toHaveBeenCalled()
  })

  test("says that it lists no engine when there is none", async () => {
    const { command, pick, openMigrationPlan } = previewOf([])

    await command.run(planUri())

    expect(informed).toEqual([
      "Pulse lists no engine, so it can't preview a plan. Configure one in the Engines view.",
    ])
    expect(pick).not.toHaveBeenCalled()
    expect(openMigrationPlan).not.toHaveBeenCalled()
  })

  test("lets you pick among the engines that check plans, and opens nothing when you cancel", async () => {
    const picking = previewOf([LOCAL, CLUSTER, SHOP_TEST], SHOP_TEST)
    const cancelling = previewOf([LOCAL, SHOP_TEST])

    await picking.command.run(planUri())
    await cancelling.command.run(planUri())

    expect(picking.pick).toHaveBeenCalledWith("Preview Migration Plan", [LOCAL, SHOP_TEST])
    expect(
      picking.openMigrationPlan.mock.calls.map(([engine, file]) => [engine, file.path]),
    ).toEqual([[SHOP_TEST, PLAN]])
    expect(cancelling.pick).toHaveBeenCalledOnce()
    expect(cancelling.openMigrationPlan).not.toHaveBeenCalled()
  })
})

describe("an open migration plan preview", () => {
  test("opens one tab per engine and file, named by the file, and reveals and refreshes it when you preview it again", () => {
    const handle = vi.spyOn(MigrationPlanPanel.prototype, "handle").mockResolvedValue(undefined)
    const local = fakeConnection("local")
    const shop = fakeConnection("shop-test")
    const { manager, close } = managerOf([local, shop])

    manager.openMigrationPlan(local, planUri())
    manager.openMigrationPlan(local, planUri())
    manager.openMigrationPlan(shop, planUri())

    expect(fake.panels.map(({ title, revealed }) => [title, revealed])).toEqual([
      ["order-v1-to-v2.migration.json", 1],
      ["order-v1-to-v2.migration.json", 0],
    ])
    expect(handle.mock.calls).toEqual([[{ type: "refresh" }]])
    close()
  })

  test("hands its session the saved file it was opened for: its name, its place, its size and its text", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const local = fakeConnection("local")
    const { manager, close } = managerOf([local])
    fake.files.set(PLAN, PLAN_TEXT)

    manager.openMigrationPlan(local, planUri())
    const [context, source] = over.mock.calls[0] ?? []

    expect(context?.runtime).toBe(local.runtime)
    expect(source).toMatchObject({
      fileName: "order-v1-to-v2.migration.json",
      location: { uri: `file://${PLAN}`, line: 1 },
    })
    expect(await source?.size()).toBe(PLAN_TEXT.length)
    expect(await source?.read()).toBe(PLAN_TEXT)
    fake.files.delete(PLAN)
    await expect(source?.read()).rejects.toThrow("missing")
    close()
  })

  test("closes with its engine and with the extension, and is the tab a definition it opens goes back to", async () => {
    const local = fakeConnection("local")
    const shop = fakeConnection("shop-test")
    const { manager, registry, close } = managerOf([local, shop])
    const over = vi.spyOn(MigrationPlanPanel, "over")
    manager.openMigrationPlan(local, planUri())
    manager.openMigrationPlan(shop, planUri())
    const [context] = over.mock.calls[0] ?? []

    context?.effects.openLatestDefinition(BpmnProcessId("order"), { toSide: false })
    fake.panels[2]?.send({ type: "goBack" })
    await vi.waitFor(() => {
      expect(fake.panels[0]?.revealed).toBe(1)
    })
    registry.reload([shop])

    expect(fake.panels.map(({ title, revealed, disposed }) => [title, revealed, disposed])).toEqual(
      [
        ["order-v1-to-v2.migration.json", 1, true],
        ["order-v1-to-v2.migration.json", 0, false],
        ["order", 0, true],
      ],
    )
    close()
    expect(fake.panels[1]?.disposed).toBe(true)
  })
})
