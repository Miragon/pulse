import { describe, expect, test } from "vitest"
import { FailingRuntime } from "@miragon/pulse-runtime-view/contract"
import { type EngineTarget, LOCAL_TARGET } from "@miragon/pulse-runtime-view/host-kit"
import { CompositionRoot } from "../src/worker/composition-root.js"
import { OrcaWorkspaceFiles } from "../src/worker/orca-workspace-files.js"
import { FakeAdapter } from "./fake-adapter.js"

const LOGIN = { kind: "basic", username: "demo", password: "demo" } as const
const BASIC: EngineTarget = { ...LOCAL_TARGET, name: "shop", auth: { kind: "basic" } }

describe("the composition root of the worker", () => {
  test("passes a login only to an engine configured for basic authentication", () => {
    const adapter = new FakeAdapter()
    const root = adapter.root()

    root.runtime(BASIC, LOGIN)
    root.runtime(LOCAL_TARGET, LOGIN)

    expect(adapter.connections.map((connection) => connection.credentials)).toEqual([
      LOGIN,
      { kind: "none" },
    ])
    expect(root.commands(BASIC, LOGIN)).toBe(adapter.engine)
  })

  test("refuses a login over plain HTTP to a remote engine", () => {
    const root = new FakeAdapter().root()
    const remote = { ...BASIC, endpoint: "http://engine.shop.invalid/engine-rest" }

    expect(root.runtime(remote, LOGIN)).toBeInstanceOf(FailingRuntime)
    expect(root.commands(remote, LOGIN)).toBeUndefined()
  })

  test("knows the web app only of an engine with its URL", () => {
    const root = new FakeAdapter().root()

    expect(root.webUi(LOCAL_TARGET)).toBeUndefined()
    expect(root.webUi({ ...LOCAL_TARGET, webUiUrl: "http://localhost:8080/cockpit" })?.name).toBe(
      "Cockpit",
    )
  })

  test("builds the real engines and the local sources", () => {
    expect(CompositionRoot.create()).toBeInstanceOf(CompositionRoot)
    expect(Object.keys(CompositionRoot.localSources(new OrcaWorkspaceFiles(() => [])))).toEqual([
      "models",
      "code",
    ])
  })
})
