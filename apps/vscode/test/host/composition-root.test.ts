import type {
  EngineAdapter,
  EngineConnection,
  EngineWebUi,
  ProcessCommands,
  ProcessRuntime,
} from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { CompositionRoot } from "../../src/host/composition-root.js"
import type { Credentials } from "../../src/host/connections/connection.js"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host/connections/engine-target.js"

const NO_LOGIN: Credentials = { kind: "none" }
const LOGIN: Credentials = { kind: "basic", username: "demo", password: "demo" }

const C7_TARGET: EngineTarget = { ...LOCAL_TARGET, name: "shop-c7" }

class RecordingAdapter implements EngineAdapter {
  readonly connections: EngineConnection[] = []
  readonly webUiUrls: string[] = []
  readonly runtimeOfIt = {} as ProcessRuntime
  readonly commandsOfIt = {} as ProcessCommands

  constructor(readonly name: string) {}

  runtime(connection: EngineConnection): ProcessRuntime {
    this.connections.push(connection)
    return this.runtimeOfIt
  }

  commands(connection: EngineConnection): ProcessCommands {
    this.connections.push(connection)
    return this.commandsOfIt
  }

  webUi(webUiUrl: string): EngineWebUi {
    this.webUiUrls.push(webUiUrl)
    return {
      name: this.name,
      overviewUrl: () => "",
      instanceUrl: () => "",
      definitionUrl: () => "",
    }
  }
}

function rootWithRecorder() {
  const c7 = new RecordingAdapter("c7")
  return { c7, root: new CompositionRoot({ c7 }) }
}

describe("the composition root", () => {
  test("asks the adapter of the engine kind for the web UI of a configured URL only", () => {
    const { c7, root } = rootWithRecorder()
    const cockpit = {
      ...C7_TARGET,
      webUiUrl: "http://localhost:18090/camunda/app/cockpit/default/",
    }

    expect(root.webUi(cockpit)?.name).toBe("c7")
    expect(root.webUi(C7_TARGET)).toBeUndefined()
    expect(c7.webUiUrls).toEqual(["http://localhost:18090/camunda/app/cockpit/default/"])
    expect(c7.connections).toEqual([])
  })

  test("hands every target to the adapter of its engine kind", () => {
    const { c7, root } = rootWithRecorder()

    expect(root.runtime(C7_TARGET, NO_LOGIN)).toBe(c7.runtimeOfIt)
    expect(root.commands(C7_TARGET, NO_LOGIN)).toBe(c7.commandsOfIt)
    expect(c7.connections).toEqual([
      { endpoint: C7_TARGET.endpoint, credentials: { kind: "none" } },
      { endpoint: C7_TARGET.endpoint, credentials: { kind: "none" } },
    ])
  })

  test("passes stored credentials only to a target configured for basic authentication", () => {
    const { c7, root } = rootWithRecorder()

    root.runtime(C7_TARGET, LOGIN)
    root.runtime({ ...C7_TARGET, auth: { kind: "basic" } }, LOGIN)

    expect(c7.connections.map((connection) => connection.credentials)).toEqual([
      { kind: "none" },
      LOGIN,
    ])
  })

  test("gives a refused target a failing runtime with the reason and no commands", async () => {
    const { c7, root } = rootWithRecorder()
    const oauth: EngineTarget = { ...C7_TARGET, auth: { kind: "oauth2" } }

    await expect(root.runtime(oauth, NO_LOGIN).listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      message: expect.stringContaining("uses OAuth2") as unknown,
    })
    expect(root.commands(oauth, NO_LOGIN)).toBeUndefined()
    expect(c7.connections).toEqual([])
  })
})
