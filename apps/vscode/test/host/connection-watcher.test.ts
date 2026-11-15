import { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import { ConnectionWatcher } from "../../src/host/connections/connection-watcher.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"

const fake = vi.hoisted(() => {
  type Listener = (value: unknown) => void
  const emitter = () => {
    const listeners: Listener[] = []
    return {
      fire: (value: unknown) => {
        for (const listener of listeners) {
          listener(value)
        }
      },
      event: (listener: Listener) => {
        listeners.push(listener)
        return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) }
      },
    }
  }
  return {
    emitter,
    watched: [] as unknown[],
    ignoresChanges: [] as unknown[],
    changed: [] as ReturnType<typeof emitter>[],
    created: [] as ReturnType<typeof emitter>[],
    fsPathOf: (path: string) => path,
  }
})

const saved = fake.emitter()
const configured = fake.emitter()

vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ fsPath: fake.fsPathOf(path) }) },
  RelativePattern: class {
    constructor(
      readonly base: { fsPath: string },
      readonly pattern: string,
    ) {}
  },
  Disposable: {
    from: (...parts: { dispose(): unknown }[]) => ({
      dispose: () => {
        for (const part of parts) {
          part.dispose()
        }
      },
    }),
  },
  workspace: {
    createFileSystemWatcher: (pattern: unknown, _create?: boolean, ignoreChanges?: boolean) => {
      fake.watched.push(pattern)
      fake.ignoresChanges.push(ignoreChanges === true)
      const [changed, created] = [fake.emitter(), fake.emitter()]
      fake.changed.push(changed)
      fake.created.push(created)
      return {
        onDidChange: changed.event,
        onDidCreate: created.event,
        onDidDelete: fake.emitter().event,
        dispose: () => undefined,
      }
    },
    onDidSaveTextDocument: (listener: (value: unknown) => void) => saved.event(listener),
    onDidChangeConfiguration: (listener: (value: unknown) => void) => configured.event(listener),
  },
}))

const OWN = new UserConfigLocation({}, "/home/dev", "linux")

function registry() {
  const calls: string[] = []
  const fakeRegistry = {
    reload: () => {
      calls.push("reload")
      return Promise.resolve()
    },
    applyLiveSettings: () => {
      calls.push("live")
    },
  } as unknown as ConnectionRegistry
  return { calls, fakeRegistry }
}

function configurationOf(...settings: string[]) {
  return {
    affectsConfiguration: (section: string) =>
      settings.some((setting) => setting === section || setting.startsWith(`${section}.`)),
  }
}

const WINDOWS = new UserConfigLocation(
  { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
  "C:\\Users\\dev",
  "win32",
)

function lowerDriveLetter(path: string): string {
  return path.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
}

beforeEach(() => {
  fake.watched.length = 0
  fake.ignoresChanges.length = 0
  fake.changed.length = 0
  fake.created.length = 0
  fake.fsPathOf = (path) => path
})

describe("the watcher of the engine files", () => {
  test("watches the project files and the CLI's user config outside the workspace", () => {
    const { calls, fakeRegistry } = registry()
    const watcher = new ConnectionWatcher(fakeRegistry, OWN)

    expect(fake.watched).toEqual([
      TargetsFile.GLOB,
      { base: { fsPath: "/home/dev/.config/pulse-cli" }, pattern: "config.json" },
      { base: { fsPath: "/home/dev/.config" }, pattern: "pulse-cli" },
    ])
    expect(fake.ignoresChanges).toEqual([false, false, true])
    fake.changed[1]?.fire(undefined)
    expect(calls).toEqual(["reload"])
    watcher.dispose()
  })

  test("reloads when the folder of the user config appears, so the CLI's first write needs no refresh", () => {
    const { calls, fakeRegistry } = registry()
    const watcher = new ConnectionWatcher(fakeRegistry, OWN)

    fake.created[2]?.fire(undefined)

    expect(calls).toEqual(["reload"])
    watcher.dispose()
  })

  test("waits for no folder above the root", () => {
    const atTheRoot = new UserConfigLocation(
      { PULSE_CLI_CONFIG: "/pulse.json" },
      "/home/dev",
      "linux",
    )
    const watcher = new ConnectionWatcher(registry().fakeRegistry, atTheRoot)

    expect(fake.watched).toEqual([
      TargetsFile.GLOB,
      { base: { fsPath: "/" }, pattern: "pulse.json" },
    ])
    watcher.dispose()
  })

  test("reloads when the user config is saved in the editor, and only then", () => {
    const { calls, fakeRegistry } = registry()
    const watcher = new ConnectionWatcher(fakeRegistry, OWN)

    saved.fire({ uri: { fsPath: "/work/notes.md" } })
    saved.fire({ uri: { fsPath: OWN.path } })

    expect(calls).toEqual(["reload"])
    watcher.dispose()
  })

  test("knows the user config saved under the drive letter VS Code writes in lower case", () => {
    fake.fsPathOf = lowerDriveLetter
    const { calls, fakeRegistry } = registry()
    const watcher = new ConnectionWatcher(fakeRegistry, WINDOWS)

    saved.fire({ uri: { fsPath: lowerDriveLetter(WINDOWS.path) } })

    expect(lowerDriveLetter(WINDOWS.path)).not.toBe(WINDOWS.path)
    expect(calls).toEqual(["reload"])
    watcher.dispose()
  })

  test("watches no file a relative PULSE_CLI_CONFIG names", () => {
    const relative = new UserConfigLocation({ PULSE_CLI_CONFIG: "ci.json" }, "/home/dev", "linux")
    const watcher = new ConnectionWatcher(registry().fakeRegistry, relative)

    expect(fake.watched).toEqual([TargetsFile.GLOB])
    watcher.dispose()
  })

  test("applies the live updates alone, and reloads for the other settings of Pulse", () => {
    const { calls, fakeRegistry } = registry()
    const watcher = new ConnectionWatcher(fakeRegistry, OWN)

    configured.fire(configurationOf("editor.fontSize"))
    configured.fire(configurationOf("pulse.liveUpdates"))
    configured.fire(configurationOf("pulse.liveUpdates", "pulse.writes"))

    expect(calls).toEqual(["live", "reload"])
    watcher.dispose()
  })
})
