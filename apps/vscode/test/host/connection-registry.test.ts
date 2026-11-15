import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import {
  ConnectionBuilder,
  CredentialStore,
  type EngineFactories,
  WriteAudit,
} from "@miragon/pulse-runtime-view/host-kit"
import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ConnectionRegistry } from "../../src/host/connections/connection-registry.js"
import { TargetsFile } from "../../src/host/connections/targets-file.js"
import { VSCODE_WRITES_WORDING } from "../../src/host/connections/writes-wording.js"

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  unreadable: new Set<string>(),
}))

vi.mock("vscode", async () => ({
  ...(await import("./support/vscode-fake.js")),
  workspace: {
    findFiles: () => Promise.resolve([...fake.files.keys()].map((fsPath) => ({ fsPath }))),
    fs: {
      readFile: (uri: { fsPath: string }) => {
        const content = fake.files.get(uri.fsPath)
        if (fake.unreadable.has(uri.fsPath)) {
          return Promise.reject(new Error("denied"))
        }
        return content === undefined
          ? Promise.reject(Object.assign(new Error("missing"), { code: "FileNotFound" }))
          : Promise.resolve(new TextEncoder().encode(content))
      },
    },
    getConfiguration: () => ({ inspect: () => undefined }),
  },
}))

const PROJECT = join("/work/shop", TargetsFile.NAME)

class Memento {
  private readonly values = new Map<string, unknown>()

  get(key: string): unknown {
    return this.values.get(key)
  }

  update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }
}

class FakeEngines implements EngineFactories {
  runtime(): ProcessRuntime {
    return new FakeEngine(FakeWorld.seed().state)
  }

  commands(): undefined {
    return undefined
  }

  webUi(): undefined {
    return undefined
  }

  cli(): undefined {
    return undefined
  }
}

function registry(): ConnectionRegistry {
  return new ConnectionRegistry(
    new Memento() as never,
    new CredentialStore({ get: () => Promise.resolve(undefined), store: () => Promise.resolve() }),
    new ConnectionBuilder(
      new FakeEngines(),
      new WriteAudit({ info: () => undefined }),
      VSCODE_WRITES_WORDING,
    ),
  )
}

beforeEach(() => {
  fake.files.clear()
  fake.unreadable.clear()
})

describe("the connections of Pulse for VS Code", () => {
  test("are the engines of the project files, the first one active until the user picks another", async () => {
    fake.files.set(
      PROJECT,
      JSON.stringify({
        profiles: {
          "shop-dev": { url: "http://localhost:8080/engine-rest" },
          "shop-test": { url: "http://test.example.com/engine-rest" },
        },
      }),
    )
    const connections = registry()
    const changed = vi.fn()
    connections.onDidChange(changed)

    await connections.reload()

    expect(connections.all().map((connection) => connection.target.name)).toEqual([
      "shop-dev",
      "shop-test",
    ])
    expect(connections.active()?.target.name).toBe("shop-dev")
    expect(changed).toHaveBeenCalledOnce()

    await connections.activate("shop-test")

    expect(connections.active()?.target.name).toBe("shop-test")
    expect(connections.byName("gone")).toBeUndefined()
  })

  test("reload past a project file Pulse can't read, which shows as a problem and no engine", async () => {
    fake.files.set(PROJECT, "{}")
    fake.unreadable.add(PROJECT)
    const connections = registry()

    await connections.reload()

    expect(connections.all()).toEqual([])
    expect(connections.active()).toBeUndefined()
    expect(connections.configurationProblems().map((problem) => problem.label())).toEqual([
      ".pulse.json: Pulse can't read this file",
    ])
  })

  test("tell who listens about a write until they are disposed", async () => {
    const connections = registry()
    await connections.reload()
    const written = vi.fn()
    connections.onDidWrite(written)

    connections.noteWrite()
    connections.dispose()
    connections.noteWrite()

    expect(written).toHaveBeenCalledOnce()
    expect(connections.all().map((connection) => connection.target.name)).toEqual(["local"])
  })
})
