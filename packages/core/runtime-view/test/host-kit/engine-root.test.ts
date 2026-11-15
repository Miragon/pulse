import {
  FailingRuntime,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import type {
  BpmnDialect,
  CliTarget,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineWebUi,
} from "../../src/ports/index.js"
import type { Credentials } from "../../src/host-kit/connections/connection.js"
import { EngineRoot } from "../../src/host-kit/connections/engine-root.js"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { LOCAL_TARGET } from "./support/local-target.js"

const NO_LOGIN: Credentials = { kind: "none" }
const LOGIN: Credentials = { kind: "basic", username: "demo", password: "demo" }

const SHOP: EngineTarget = { ...LOCAL_TARGET, name: "shop" }
const CLUSTER: EngineTarget = {
  ...LOCAL_TARGET,
  name: "cluster",
  engine: "c8",
  endpoint: "http://localhost:8088/v2",
}

class RecordingAdapter implements EngineAdapter {
  readonly connections: EngineConnection[] = []
  readonly webUiUrls: string[] = []
  readonly cliTargets: CliTarget[] = []
  readonly cliOfIt: EngineCli = { triggerCommand: () => undefined }
  readonly runtimeOfIt = {} as ProcessRuntime
  readonly commandsOfIt = {} as ProcessCommands
  readonly bpmn: BpmnDialect

  constructor(
    readonly name: string,
    readonly localEndpoint: string,
  ) {
    this.bpmn = {
      descriptor: { prefix: name, uri: `http://${name}.invalid/bpmn` },
      fallback: false,
      implementations: [],
      mappings: [],
      errorDefinitions: [],
      workerMarkers: [],
    }
  }

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

  cli(target: CliTarget): EngineCli {
    this.cliTargets.push(target)
    return this.cliOfIt
  }
}

function rootOver(local: "c7" | "c8" = "c7") {
  const c7 = new RecordingAdapter("first", "http://localhost:9090/engine-rest")
  const c8 = new RecordingAdapter("second", "http://localhost:8088/v2")
  return { c7, c8, root: EngineRoot.of({ c7, c8 }, { local }) }
}

describe("the engine root both editor hosts build from their adapters", () => {
  test("hands every target to the adapter of its dialect", () => {
    const { c7, c8, root } = rootOver()

    expect(root.runtime(SHOP, NO_LOGIN)).toBe(c7.runtimeOfIt)
    expect(root.commands(SHOP, NO_LOGIN)).toBe(c7.commandsOfIt)
    expect(root.runtime(CLUSTER, NO_LOGIN)).toBe(c8.runtimeOfIt)
    expect(c7.connections).toEqual([
      { endpoint: SHOP.endpoint, credentials: { kind: "none" } },
      { endpoint: SHOP.endpoint, credentials: { kind: "none" } },
    ])
    expect(c8.connections).toEqual([{ endpoint: CLUSTER.endpoint, credentials: { kind: "none" } }])
  })

  test("passes stored credentials only to a target configured for basic authentication", () => {
    const { c7, root } = rootOver()

    root.runtime(SHOP, LOGIN)
    root.runtime({ ...SHOP, auth: { kind: "basic" } }, LOGIN)
    root.runtime({ ...SHOP, auth: { kind: "basic" } }, NO_LOGIN)

    expect(c7.connections.map((connection) => connection.credentials)).toEqual([
      { kind: "none" },
      LOGIN,
      { kind: "none" },
    ])
  })

  test("gives a refused target a failing runtime with the reason and no commands", async () => {
    const { c7, root } = rootOver()
    const oauth: EngineTarget = { ...SHOP, auth: { kind: "oauth2" } }

    await expect(root.runtime(oauth, NO_LOGIN).listDefinitions()).rejects.toMatchObject({
      failure: "misconfigured",
      message:
        'Profile "shop" uses auth.type oauth, which this client cannot authenticate with. Set auth.type to none, or to basic without the OAuth keys, or keep this profile for the CLI.',
    })
    expect(root.commands(oauth, NO_LOGIN)).toBeUndefined()
    expect(c7.connections).toEqual([])
  })

  test("refuses a login over plain HTTP to a remote engine", () => {
    const { c7, root } = rootOver()
    const remote: EngineTarget = {
      ...SHOP,
      auth: { kind: "basic" },
      endpoint: "http://engine.shop.invalid/engine-rest",
    }

    expect(root.runtime(remote, LOGIN)).toBeInstanceOf(FailingRuntime)
    expect(root.commands(remote, LOGIN)).toBeUndefined()
    expect(c7.connections).toEqual([])
  })

  test("asks the adapter of the dialect for the web UI of a configured URL only", () => {
    const { c7, c8, root } = rootOver()
    const operate = "http://localhost:8088/operate"

    expect(root.webUi({ ...SHOP, webUiUrl: "http://localhost:9090/camunda" })?.name).toBe("first")
    expect(root.webUi({ ...CLUSTER, webUiUrl: operate })?.name).toBe("second")
    expect(root.webUi(SHOP)).toBeUndefined()
    expect(c7.webUiUrls).toEqual(["http://localhost:9090/camunda"])
    expect(c8.webUiUrls).toEqual([operate])
    expect(c7.connections).toEqual([])
  })

  test("asks the adapter of the dialect for its CLI, which names the target it is given", () => {
    const { c7, root } = rootOver()
    const profile = { kind: "profile", name: "shop", endpoint: SHOP.endpoint } as const
    const endpoint = { kind: "endpoint", endpoint: SHOP.endpoint } as const

    expect(root.cli(SHOP, profile)).toBe(c7.cliOfIt)
    expect(root.cli(SHOP, endpoint)).toBe(c7.cliOfIt)
    expect(c7.cliTargets).toEqual([profile, endpoint])
  })

  test("falls back to the local endpoint of the dialect the composition root names", () => {
    expect(rootOver().root.localTarget()).toEqual({
      name: "local",
      engine: "c7",
      endpoint: "http://localhost:9090/engine-rest",
      auth: { kind: "none" },
      source: { kind: "default" },
    })
    expect(rootOver("c8").root.localTarget()).toMatchObject({
      engine: "c8",
      endpoint: "http://localhost:8088/v2",
    })
  })

  test("hands the model reader the BPMN dialect of every adapter", () => {
    const { c7, c8, root } = rootOver()

    expect(root.dialects()).toEqual([c7.bpmn, c8.bpmn])
  })
})
