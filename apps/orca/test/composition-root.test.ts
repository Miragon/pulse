import { describe, expect, test } from "vitest"
import { FailingRuntime } from "@miragon/pulse-engine-core"
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

  test("refuses an engine that signs in with OAuth2 and names the way out", async () => {
    const adapter = new FakeAdapter()
    const root = adapter.root()
    const oauth: EngineTarget = { ...LOCAL_TARGET, name: "shop", auth: { kind: "oauth2" } }

    await expect(root.runtime(oauth, LOGIN).listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      message:
        'Profile "shop" uses auth.type oauth, which this client cannot authenticate with. Set auth.type to none, or to basic without the OAuth keys, or keep this profile for the CLI.',
    })
    expect(root.commands(oauth, LOGIN)).toBeUndefined()
    expect(adapter.connections).toEqual([])
  })

  test("knows the web app only of an engine with its URL", () => {
    const root = new FakeAdapter().root()

    expect(root.webUi(LOCAL_TARGET)).toBeUndefined()
    expect(root.webUi({ ...LOCAL_TARGET, webUiUrl: "http://localhost:8080/cockpit" })?.name).toBe(
      "Cockpit",
    )
  })

  test("asks the adapter for its CLI, which names the target it is given", () => {
    const adapter = new FakeAdapter()
    const root = adapter.root()
    const profile = { kind: "profile", name: "shop" } as const
    const endpoint = { kind: "endpoint", endpoint: LOCAL_TARGET.endpoint } as const

    expect(root.cli(BASIC, profile)).toBe(adapter.cliOfIt)
    expect(root.cli(LOCAL_TARGET, endpoint)).toBe(adapter.cliOfIt)
    expect(adapter.cliTargets).toEqual([profile, endpoint])
  })

  test("builds the real engines and the local sources", () => {
    expect(CompositionRoot.create()).toBeInstanceOf(CompositionRoot)
    expect(Object.keys(CompositionRoot.localSources(new OrcaWorkspaceFiles(() => [])))).toEqual([
      "models",
      "code",
    ])
  })
})
