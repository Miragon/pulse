import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Uri } from "vscode"
import { BoardPanels } from "../../src/host/boards/board-panels.js"
import { BoardWatcher } from "../../src/host/boards/board-watcher.js"
import { BoardsTree } from "../../src/host/boards/boards-tree.js"
import { NewBoardCommand } from "../../src/host/commands/new-board-command.js"
import { OpenBoardCommand } from "../../src/host/commands/open-board-command.js"
import type { Connection } from "../../src/host/connections/connection.js"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import type { PanelManager } from "../../src/host/panels/panel-manager.js"
import type { HostMessage, PanelState } from "../../src/core/protocol/index.js"
import { RuntimeError } from "../../src/contract/index.js"
import { BoardParser } from "../../src/core/index.js"
import { instance } from "../core/support/board-fixture.js"

interface FakeUri {
  readonly path: string
  readonly fsPath: string
  toString(): string
}

const fake = vi.hoisted(() => {
  const listeners = () => {
    const all: ((value: unknown) => void)[] = []
    return {
      all,
      event: (listener: (value: unknown) => void) => {
        all.push(listener)
        return { dispose: () => all.splice(all.indexOf(listener), 1) }
      },
    }
  }
  class Uri {
    readonly fsPath: string

    constructor(readonly path: string) {
      this.fsPath = path
    }

    static joinPath(base: { readonly path: string }, ...parts: string[]): Uri {
      return new Uri([base.path, ...parts].join("/"))
    }

    toString(): string {
      return `file://${this.path}`
    }
  }
  return {
    Uri,
    listeners,
    files: new Map<string, string>(),
    commands: [] as unknown[][],
    copied: [] as string[],
    shown: [] as unknown[][],
    inputs: [] as (string | undefined)[],
    folders: [] as { uri: unknown }[],
    watcher: { change: listeners(), create: listeners(), remove: listeners() },
  }
})

function uri(path: string): Uri {
  return new fake.Uri(path) as unknown as Uri
}

vi.mock("vscode", () => {
  class TreeItem {
    description?: string
    tooltip?: string
    iconPath?: unknown
    command?: unknown
    contextValue?: string
    accessibilityInformation?: unknown
    constructor(readonly label: string) {}
  }
  class EventEmitter {
    private readonly listeners = fake.listeners()
    readonly event = this.listeners.event
    fire(value: unknown) {
      for (const listener of this.listeners.all) {
        listener(value)
      }
    }
    dispose() {
      this.listeners.all.length = 0
    }
  }
  return {
    TreeItem,
    EventEmitter,
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
    ThemeColor: class {
      constructor(readonly id: string) {}
    },
    ViewColumn: { Active: -1, Beside: -2 },
    Disposable: {
      from: (...parts: { dispose(): unknown }[]) => ({
        dispose: () => {
          parts.forEach((part) => part.dispose())
        },
      }),
    },
    Uri: fake.Uri,
    env: {
      clipboard: {
        writeText: (text: string) => {
          fake.copied.push(text)
          return Promise.resolve()
        },
      },
    },
    commands: {
      executeCommand: (...args: unknown[]) => {
        fake.commands.push(args)
        return Promise.resolve()
      },
    },
    window: {
      createTreeView: () => ({ dispose: () => undefined }),
      showTextDocument: (...args: unknown[]) => {
        fake.shown.push(args)
        return Promise.resolve()
      },
      showInputBox: async (options: {
        validateInput: (value: string) => Promise<string | undefined>
      }) => {
        const answer = fake.inputs.shift()
        const checks = await Promise.all(["!!!", "Shop payments"].map(options.validateInput))
        fake.shown.push(["validate", ...checks])
        return answer
      },
      setStatusBarMessage: (message: string) => {
        fake.shown.push(["status", message])
        return { dispose: () => undefined }
      },
      showInformationMessage: (message: string) => {
        fake.shown.push(["inform", message])
        return Promise.resolve()
      },
    },
    workspace: {
      get workspaceFolders() {
        return fake.folders
      },
      findFiles: () => Promise.resolve([...fake.files.keys()].map((path) => uri(path))),
      fs: {
        stat: (file: FakeUri) =>
          fake.files.has(file.path) ? Promise.resolve({}) : Promise.reject(new Error("missing")),
        readFile: (file: FakeUri) => {
          const content = fake.files.get(file.path)
          return content === undefined
            ? Promise.reject(new Error("missing"))
            : Promise.resolve(new TextEncoder().encode(content))
        },
        writeFile: (file: FakeUri, bytes: Uint8Array) => {
          fake.files.set(file.path, new TextDecoder().decode(bytes))
          return Promise.resolve()
        },
      },
      createFileSystemWatcher: () => ({
        onDidChange: fake.watcher.change.event,
        onDidCreate: fake.watcher.create.event,
        onDidDelete: fake.watcher.remove.event,
        dispose: () => undefined,
      }),
    },
  }
})

vi.mock("@miragon/modeler-shell/vscode/extension", () => ({
  connectThemeBridge: () => ({ dispose: () => undefined }),
}))

const VALID = JSON.stringify({ title: "Payments", engines: ["shop"], rows: [] })

function webviewPanel() {
  const received = fake.listeners()
  const disposed = fake.listeners()
  const panel = {
    title: "",
    posted: [] as HostMessage[],
    revealed: 0,
    webview: {
      onDidReceiveMessage: received.event,
      postMessage: (message: HostMessage) => {
        panel.posted.push(message)
        return Promise.resolve(true)
      },
    },
    reveal: () => {
      panel.revealed += 1
    },
    onDidDispose: disposed.event,
    dispose: () => {
      for (const listener of disposed.all) {
        listener(undefined)
      }
    },
    send: (message: unknown) => {
      for (const listener of received.all) {
        listener(message)
      }
    },
  }
  return panel
}

function setup() {
  const changed = fake.listeners()
  const connection = {
    target: { name: "shop" },
    badge: { name: "shop", environment: "test", host: "shop" },
    runtime: {
      describeEngine: () => Promise.resolve({ product: "Engine", version: "1" }),
      countInstances: () => Promise.resolve(4),
      searchInstances: () => Promise.resolve({ items: [instance("i-1", "order")] }),
    },
    definitions: { read: () => Promise.resolve([]) },
  } as unknown as Connection
  const locked = {
    target: { name: "locked" },
    badge: { name: "locked", environment: "test", host: "locked" },
    runtime: {
      describeEngine: () => Promise.reject(new RuntimeError("unauthorized", "HTTP 401")),
    },
    definitions: { read: () => Promise.resolve([]) },
  } as unknown as Connection
  const known = new Map([
    ["shop", connection],
    ["locked", locked],
  ])
  const registry = {
    byName: (name: string) => known.get(name),
    all: () => [...known.values()],
    onDidChange: changed.event,
  } as unknown as ConnectionRegistry
  const panels = [] as ReturnType<typeof webviewPanel>[]
  const opened = [] as unknown[][]
  const manager = {
    createWebview: (title: string) => {
      const panel = webviewPanel()
      panel.title = title
      panels.push(panel)
      return panel
    },
    openInstance: (...args: unknown[]) => opened.push(["instance", ...args]),
    openDefinition: (...args: unknown[]) => opened.push(["definition", ...args]),
    openEngine: (...args: unknown[]) => opened.push(["engine", ...args]),
  } as unknown as PanelManager
  return { registry, manager, panels, opened, connection, locked, registryChanged: changed.all }
}

function fire(listeners: readonly ((value: unknown) => void)[], value: unknown): void {
  for (const listener of listeners) {
    listener(value)
  }
}

async function titled(panel: ReturnType<typeof webviewPanel>, title: string): Promise<void> {
  await vi.waitFor(() => {
    expect(lastState(panel)).toMatchObject({ status: "ready", view: { title } })
  })
}

function lastState(panel: ReturnType<typeof webviewPanel>): PanelState | undefined {
  return panel.posted.at(-1)?.state
}

beforeEach(() => {
  fake.files.clear()
  fake.commands.length = 0
  fake.copied.length = 0
  fake.shown.length = 0
  fake.inputs.length = 0
  fake.folders.length = 0
})

describe("the boards view", () => {
  test("lists each board by its title and marks a broken one with its problem count", async () => {
    fake.files.set("/w/.pulse/boards/payments.board.json", VALID)
    fake.files.set("/w/.pulse/boards/broken.board.json", "{")
    const tree = new BoardsTree()

    const nodes = await tree.getChildren()
    const items = nodes.map((node) => tree.getTreeItem(node))

    expect(items.map((item) => [item.label, item.description])).toEqual([
      ["broken.board.json", "1 problem"],
      ["Payments", "payments.board.json"],
    ])
    expect(items[1]?.command).toEqual({
      command: "pulse.openBoard",
      title: "Open Board",
      arguments: [nodes[1]?.file],
    })
    expect(items[1]?.accessibilityInformation).toEqual({ label: "Payments, payments.board.json" })
    expect(await tree.getChildren(nodes[0])).toEqual([])
    expect(fake.commands).toContainEqual(["setContext", "pulse.hasBoards", true])
    tree.dispose()
  })

  test("counts several problems and announces when there is no board", async () => {
    fake.files.set("/w/.pulse/boards/empty.board.json", "{}")
    const tree = new BoardsTree()
    const [node] = await tree.getChildren()

    expect(tree.getTreeItem(node!).description).toBe("3 problems")

    fake.files.clear()
    tree.refresh()
    await vi.waitFor(() => {
      expect(fake.commands.at(-1)).toEqual(["setContext", "pulse.hasBoards", false])
    })
  })
})

describe("an open board", () => {
  test("opens once per file, reads it when the webview is ready and names its tab", async () => {
    fake.files.set("/w/.pulse/boards/payments.board.json", VALID)
    const { registry, manager, panels } = setup()
    const boards = new BoardPanels(registry, manager)
    const command = new OpenBoardCommand(boards)

    command.run(uri("/w/.pulse/boards/payments.board.json"))
    command.run(uri("/w/.pulse/boards/payments.board.json"))
    command.run("not a file")
    panels[0]?.send({ type: "ready" })
    panels[0]?.send({ type: "activity" })
    panels[0]?.send({ type: "no such intent" })
    await vi.waitFor(() => {
      expect(lastState(panels[0]!)).toMatchObject({ status: "ready", view: { title: "Payments" } })
    })

    expect(panels).toHaveLength(1)
    expect(panels[0]?.revealed).toBe(1)
    expect(panels[0]?.title).toBe("Payments · Board")
    boards.dispose()
  })

  test("reads the file again when it changes on disk or the engines change", async () => {
    const file = "/w/.pulse/boards/payments.board.json"
    fake.files.set(file, VALID)
    const { registry, manager, panels, registryChanged } = setup()
    const boards = new BoardPanels(registry, manager)
    const tree = new BoardsTree()
    const watcher = new BoardWatcher(tree, boards)
    boards.open(uri(file))
    panels[0]?.send({ type: "ready" })
    await titled(panels[0]!, "Payments")

    fake.files.set(file, JSON.stringify({ title: "Renamed", engines: ["shop"], rows: [] }))
    fire(fake.watcher.change.all, uri(file))
    await titled(panels[0]!, "Renamed")

    fake.files.set(file, JSON.stringify({ title: "Again", engines: ["shop"], rows: [] }))
    fire(registryChanged, undefined)
    await titled(panels[0]!, "Again")

    const announced = fake.commands.length
    fake.files.set("/w/.pulse/boards/other.board.json", VALID)
    fire(fake.watcher.create.all, uri("/w/.pulse/boards/other.board.json"))
    await vi.waitFor(() => {
      expect(fake.commands.slice(announced)).toContainEqual(["setContext", "pulse.hasBoards", true])
    })

    fake.files.delete(file)
    fire(fake.watcher.remove.all, uri(file))
    await vi.waitFor(() => {
      expect(lastState(panels[0]!)).toMatchObject({
        view: { title: "Again", problems: [{ path: "(file)", reason: "could not be read" }] },
      })
    })

    panels[0]?.dispose()
    boards.open(uri(file))
    expect(panels).toHaveLength(2)
    watcher.dispose()
    boards.dispose()
  })

  test("opens instances, processes and engines on the engine the board names", async () => {
    const file = "/w/.pulse/boards/payments.board.json"
    fake.files.set(
      file,
      JSON.stringify({
        title: "Payments",
        engines: ["shop", "gone", "locked"],
        rows: [
          {
            row: [
              { widget: "counter", props: { filter: { process: "order" } } },
              { widget: "instanceList", props: { filter: { process: "order" } } },
            ],
          },
        ],
      }),
    )
    const { registry, manager, panels, opened, connection, locked } = setup()
    const boards = new BoardPanels(registry, manager)
    boards.open(uri(file))
    const panel = panels[0]!
    panel.send({ type: "ready" })
    await vi.waitFor(() => {
      expect(lastState(panel)).toMatchObject({ status: "ready", view: { title: "Payments" } })
    })

    const filter = { scope: "running" }
    panel.send({
      type: "openBoardProcess",
      engine: "shop",
      bpmnProcessId: "order",
      filter,
      toSide: true,
    })
    panel.send({ type: "openBoardEngine", engine: "shop", toSide: false })
    panel.send({ type: "openBoardInstance", engine: "shop", instanceId: "i-1", toSide: false })
    panel.send({ type: "setBoardCredentials", engine: "locked" })
    panel.send({ type: "openBoardFile" })
    panel.send({ type: "copy", text: "i-1", label: "Instance ID" })
    panel.send({ type: "editConnection" })
    await vi.waitFor(() => {
      expect(fake.commands).toContainEqual(["pulse.openTargetsFile"])
    })

    expect(opened).toEqual([
      ["definition", connection, { bpmnProcessId: "order", filter }, -2],
      ["engine", connection, -1],
      ["instance", connection, "i-1", -1],
    ])
    expect(fake.commands).toContainEqual(["pulse.setCredentials", { connection: locked }])
    expect(fake.copied).toEqual(["i-1"])
    expect(fake.shown).toContainEqual(["status", "$(check) Copied Instance ID"])
    const [shownFile, shownOptions] = fake.shown[0] ?? []
    expect((shownFile as FakeUri).path).toBe(file)
    expect(shownOptions).toEqual({ viewColumn: -2 })
    expect(lastState(panel)).toMatchObject({
      view: {
        engines: [
          { name: "shop", state: "ready" },
          { name: "gone", state: "notConfigured" },
          { name: "locked", state: "failed" },
        ],
      },
    })
    boards.dispose()
  })
})

describe("a new board", () => {
  test("lands in .pulse/boards of the first folder with every engine and opens", async () => {
    fake.folders.push({ uri: uri("/w") })
    fake.inputs.push("  Shop: Payments  ")
    const { registry, manager, panels } = setup()

    await new NewBoardCommand(registry, new BoardPanels(registry, manager)).run()

    const written = BoardParser.parse(
      fake.files.get("/w/.pulse/boards/shop-payments.board.json") ?? "",
    )
    expect(written).toHaveProperty("board.title", "Shop: Payments")
    expect(written).toHaveProperty("board.engines", ["shop", "locked"])
    expect(fake.shown[0]).toEqual(["validate", "Enter a name with letters or digits.", undefined])
    expect(panels).toHaveLength(1)
  })

  test("never overwrites a board that exists", async () => {
    fake.folders.push({ uri: uri("/w") })
    fake.files.set("/w/.pulse/boards/shop-payments.board.json", VALID)
    const { registry, manager } = setup()

    await new NewBoardCommand(registry, new BoardPanels(registry, manager)).run()

    expect(fake.shown[0]).toEqual([
      "validate",
      "Enter a name with letters or digits.",
      "shop-payments.board.json exists. Choose another name.",
    ])
    expect(fake.files.get("/w/.pulse/boards/shop-payments.board.json")).toBe(VALID)
  })

  test("asks for a folder first and stops when the name is cancelled", async () => {
    const { registry, manager } = setup()
    const command = new NewBoardCommand(registry, new BoardPanels(registry, manager))

    await command.run()
    fake.folders.push({ uri: uri("/w") })
    await command.run()

    expect(fake.shown[0]).toEqual(["inform", "Open a folder to keep boards in .pulse/boards."])
    expect(fake.files.size).toBe(0)
  })
})
