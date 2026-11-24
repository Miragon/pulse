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
import { EditMigrationPlanCommand } from "../../src/host/commands/edit-migration-plan-command.js"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import { CompositionRoot } from "../../src/host/composition-root.js"
import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"
import { LiveWiring } from "../../src/host/live/live-wiring.js"
import { WindowAttention } from "../../src/host/live/window-attention.js"
import { PanelManager } from "../../src/host/panels/panel-manager.js"
import type { PanelHost } from "../../src/host/panels/vscode-panel-effects.js"
import { MigrationPlanEditors } from "../../src/host/plans/migration-plan-editors.js"
import { PlanEngines } from "../../src/host/plans/plan-engines.js"
import { ConnectionLive } from "./support/connection-live.js"
import { FakeRegistry } from "./support/fake-registry.js"
import { LOCAL_TARGET } from "./support/local-target.js"
import {
  FakeTextDocument,
  TabInputCustom,
  TabInputText,
  Uri,
  documentChanged,
  edits,
  executed,
  informed,
  tabGroups,
  textDocuments,
} from "./support/vscode-fake.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

vi.mock("@miragon/modeler-shell/vscode/extension", () => ({
  connectThemeBridge: () => ({ dispose: () => undefined }),
  currentAppearance: () => ({}),
  renderWebviewHtml: () => "<html></html>",
}))

const PLAN = "/w/.pulse/migrations/order-v1-to-v2.migration.json"
const PLAN_TEXT =
  '{ "bpmnProcessId": "order", "source": { "version": 1 }, "target": { "version": 2 }, "mappings": [] }\n'
const ENGINES = CompositionRoot.create().engines

interface FakePanel {
  readonly webview: { html: string; options: unknown; send(message: unknown): void }
  disposed: boolean
  revealed: number
  dispose(): void
}

function planUri(path = PLAN): vscode.Uri {
  return Uri.file(path) as unknown as vscode.Uri
}

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

function fakePanel(): vscode.WebviewPanel & FakePanel {
  const listeners = {
    received: [] as ((message: unknown) => void)[],
    disposed: [] as (() => void)[],
  }
  const on = (list: ((value: never) => void)[]) => (listener: (value: never) => void) => {
    list.push(listener)
    return { dispose: () => undefined }
  }
  const panel = {
    title: "",
    revealed: 0,
    disposed: false,
    visible: false,
    active: false,
    webview: {
      html: "",
      options: undefined as unknown,
      cspSource: "vscode-resource:",
      asWebviewUri: (uri: unknown) => uri,
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: on(listeners.received),
      send: (message: unknown) => {
        for (const listener of listeners.received) {
          listener(message)
        }
      },
    },
    onDidChangeViewState: () => ({ dispose: () => undefined }),
    onDidDispose: on(listeners.disposed),
    reveal: () => {
      panel.revealed += 1
    },
    dispose: () => {
      panel.disposed = true
      for (const listener of listeners.disposed) {
        listener()
      }
    },
  }
  return panel as unknown as vscode.WebviewPanel & FakePanel
}

function choosing(connections: readonly Connection[], picked?: Connection) {
  const pick = vi.fn<ConnectionPicker["pick"]>(() => Promise.resolve(picked))
  const engines = new PlanEngines(
    new FakeRegistry(connections).asRegistry(),
    { pick } as unknown as ConnectionPicker,
    ENGINES,
  )
  return { engines, pick }
}

function memento(): vscode.Memento {
  const stored = new Map<string, unknown>()
  return {
    keys: () => [...stored.keys()],
    get: (key: string) => stored.get(key),
    update: (key: string, value: unknown) => {
      stored.set(key, value)
      return Promise.resolve()
    },
  }
}

function editorsOf(
  connections: readonly Connection[],
  picked?: Connection,
  memory: vscode.Memento = memento(),
) {
  const registry = new FakeRegistry(connections)
  const attention = new WindowAttention()
  const manager = new PanelManager(
    Uri.file("/extension") as unknown as vscode.Uri,
    { registry: registry.asRegistry() } as unknown as PanelHost,
    new LiveWiring(attention, () => undefined),
  )
  const { engines, pick } = choosing(connections, picked)
  const editors = new MigrationPlanEditors(engines, manager, memory)
  const document = new FakeTextDocument(Uri.file(PLAN), PLAN_TEXT)
  textDocuments.push(document)
  const close = () => {
    manager.dispose()
    attention.dispose()
  }
  return { editors, manager, registry, pick, document, close }
}

function asDocument(document: FakeTextDocument): vscode.TextDocument {
  return document as unknown as vscode.TextDocument
}

beforeEach(() => {
  informed.length = 0
  executed.length = 0
  textDocuments.length = 0
  edits.applied.length = 0
  edits.refused = false
  delete tabGroups.activeTabGroup.activeTab
})

describe("Edit Migration Plan", () => {
  test("edits the plan file it is given, else the one in the active tab, as text or in the editor", async () => {
    const open = vi.fn<MigrationPlanEditors["open"]>(() => Promise.resolve())
    const command = new EditMigrationPlanCommand({ open })
    const other = planUri("/w/plans/invoice.migration.json")

    await command.run(planUri())
    tabGroups.activeTabGroup.activeTab = { input: new TabInputText(Uri.file(other.path)) }
    await command.run()
    tabGroups.activeTabGroup.activeTab = {
      input: new TabInputCustom(Uri.file(PLAN), MigrationPlanEditors.VIEW_TYPE),
    }
    await command.run("not a file")

    expect(open.mock.calls.map(([file]) => file.path)).toEqual([PLAN, other.path, PLAN])
    expect(informed).toEqual([])
  })

  test("asks for a plan file when none is open or the file is no plan", async () => {
    const open = vi.fn<MigrationPlanEditors["open"]>(() => Promise.resolve())
    const command = new EditMigrationPlanCommand({ open })

    await command.run()
    await command.run(planUri("/w/.pulse/boards/payments.board.json"))
    tabGroups.activeTabGroup.activeTab = { input: new TabInputText(Uri.file("/w/.migration.json")) }
    await command.run()

    expect(informed).toEqual(
      Array(3).fill("Open a migration plan file (.migration.json) to edit it."),
    )
    expect(open).not.toHaveBeenCalled()
  })
})

describe("the engine a plan is checked on", () => {
  test("is the only one that checks plans, never one that doesn't or that Pulse refuses", async () => {
    const none = choosing([CLUSTER, CLUSTER_SSO])
    const one = choosing([CLUSTER, SHOP_SSO, LOCAL])

    expect(await none.engines.choose("Edit Migration Plan")).toBeUndefined()
    expect(await one.engines.choose("Edit Migration Plan")).toBe(LOCAL)

    expect("checkMigration" in CLUSTER.runtime).toBe(false)
    expect("checkMigration" in CLUSTER_SSO.runtime).toBe(true)
    expect(informed).toEqual([
      "None of the configured engines checks migration plans, so Pulse can't check one.",
    ])
    expect(one.pick).not.toHaveBeenCalled()
  })

  test("names the engines that check plans when Pulse refuses the connection to each of them, and says when it lists none", async () => {
    await choosing([SHOP_SSO]).engines.choose("Edit Migration Plan")
    await choosing([CLUSTER, SHOP_SSO, SHOP_LEGACY]).engines.choose("Edit Migration Plan")
    await choosing([]).engines.choose("Edit Migration Plan")

    expect(informed).toEqual([
      "Pulse refuses the connection to shop-sso, so it can't check a plan there. Expand shop-sso in the Engines view to see why and what to change.",
      "Pulse refuses the connections to shop-sso and shop-legacy, so it can't check a plan there. Expand them in the Engines view to see why and what to change.",
      "Pulse lists no engine, so it can't check a plan. Configure one in the Engines view.",
    ])
  })

  test("is the one you pick among several, and none when you cancel", async () => {
    const picking = choosing([LOCAL, CLUSTER, SHOP_TEST], SHOP_TEST)
    const cancelling = choosing([LOCAL, SHOP_TEST])

    expect(await picking.engines.choose("Edit Migration Plan")).toBe(SHOP_TEST)
    expect(await cancelling.engines.choose("Edit Migration Plan")).toBeUndefined()
    expect(picking.pick).toHaveBeenCalledWith("Edit Migration Plan", [LOCAL, SHOP_TEST])
  })
})

describe("the migration plan editor", () => {
  test("opens the file in the graphical editor on the engine you chose, without asking again", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const shop = fakeConnection("shop-test")
    const { editors, pick, document, close } = editorsOf([fakeConnection("local"), shop], shop)
    const panel = fakePanel()

    await editors.open(planUri())
    await editors.resolveCustomTextEditor(asDocument(document), panel)

    expect(executed).toEqual([["vscode.openWith", planUri(), MigrationPlanEditors.VIEW_TYPE]])
    expect(pick).toHaveBeenCalledOnce()
    expect(panel.webview.html).toBe("<html></html>")
    expect(panel.webview.options).toMatchObject({ enableScripts: true })
    expect(over.mock.calls[0]?.[0].runtime).toBe(shop.runtime)
    close()
  })

  test("asks for the engine when VS Code opens the editor by itself", async () => {
    const shop = fakeConnection("shop-test")
    const { editors, pick, document, close } = editorsOf([fakeConnection("local"), shop], shop)

    await editors.resolveCustomTextEditor(asDocument(document), fakePanel())

    expect(pick).toHaveBeenCalledWith("Edit Migration Plan", expect.any(Array))
    close()
  })

  test("reopens a restored editor on the engine it was last checked on, without asking", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const local = fakeConnection("local")
    const shop = fakeConnection("shop-test")
    const memory = memento()
    const first = editorsOf([local, shop], shop, memory)
    await first.editors.open(planUri())
    first.close()
    const again = editorsOf([local, shop], local, memory)

    await again.editors.resolveCustomTextEditor(asDocument(again.document), fakePanel())

    expect(again.pick).not.toHaveBeenCalled()
    expect(over.mock.calls.at(-1)?.[0].runtime).toBe(shop.runtime)
    again.close()
  })

  test("leaves an editor alone that you closed while Pulse asked for the engine", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const shop = fakeConnection("shop-test")
    const { editors, pick, document, close } = editorsOf([fakeConnection("local"), shop])
    const panel = fakePanel()
    pick.mockImplementation(() => {
      panel.dispose()
      return Promise.resolve(shop)
    })

    await editors.resolveCustomTextEditor(asDocument(document), panel)

    expect(panel.webview.html).toBe("")
    expect(over).not.toHaveBeenCalled()
    close()
  })

  test("opens the text instead when no engine checks the plan", async () => {
    const { editors, document, close } = editorsOf([])
    const panel = fakePanel()

    await editors.resolveCustomTextEditor(asDocument(document), panel)

    expect(panel.disposed).toBe(true)
    expect(executed).toEqual([["vscode.openWith", document.uri, "default"]])
    expect(informed).toHaveLength(1)
    close()
  })

  test("checks an open plan on the engine you pick next instead of opening it twice", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const local = fakeConnection("local")
    const shop = fakeConnection("shop-test")
    const { editors, pick, document, close } = editorsOf([local, shop], local)
    await editors.resolveCustomTextEditor(asDocument(document), fakePanel())
    pick.mockResolvedValue(shop)

    await editors.open(planUri())

    expect(over.mock.calls.map(([context]) => context.runtime)).toEqual([
      local.runtime,
      shop.runtime,
    ])
    expect(executed).toEqual([["vscode.openWith", planUri(), MigrationPlanEditors.VIEW_TYPE]])
    close()
  })

  test("reads the open document, writes an edit as one change of it and tells the editor about every change", async () => {
    const over = vi.spyOn(MigrationPlanPanel, "over")
    const changed = vi.spyOn(MigrationPlanPanel.prototype, "changed").mockResolvedValue(undefined)
    const local = fakeConnection("local")
    const { editors, document, close } = editorsOf([local], local)
    const panel = fakePanel()
    await editors.resolveCustomTextEditor(asDocument(document), panel)
    const [, source] = over.mock.calls[0] ?? []

    expect(source).toMatchObject({
      fileName: "order-v1-to-v2.migration.json",
      location: { uri: `file://${PLAN}`, line: 1, beside: true },
    })
    expect(await source?.size()).toBe(PLAN_TEXT.length)
    expect(await source?.read()).toBe(PLAN_TEXT)
    expect(await source?.write(PLAN_TEXT)).toBe(true)
    expect(edits.applied).toEqual([])

    expect(await source?.write("{}\n")).toBe(true)
    expect(
      edits.applied.map((edit) =>
        edit.replaced.map(({ range, text }) => [range.end.character, text]),
      ),
    ).toEqual([[[PLAN_TEXT.length, "{}\n"]]])
    expect(document.text).toBe("{}\n")
    edits.refused = true
    expect(await source?.write("[]\n")).toBe(false)
    documentChanged.fire({ document: new FakeTextDocument(Uri.file("/w/other.json"), "") })
    expect(changed).toHaveBeenCalledOnce()

    panel.dispose()
    documentChanged.fire({ document })
    expect(changed).toHaveBeenCalledOnce()
    close()
  })

  test("closes with its engine", () => {
    const local = fakeConnection("local")
    const shop = fakeConnection("shop-test")
    const { manager, registry, document, close } = editorsOf([local, shop])
    const onLocal = fakePanel()
    const onShop = fakePanel()
    manager.adoptMigrationPlan(local, asDocument(document), onLocal)
    manager.adoptMigrationPlan(shop, asDocument(document), onShop)

    registry.reload([shop])

    expect([onLocal.disposed, onShop.disposed]).toEqual([true, false])
    close()
    expect(onShop.disposed).toBe(true)
  })
})
