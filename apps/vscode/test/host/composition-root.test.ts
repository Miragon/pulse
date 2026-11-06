import type {
  BpmnDialect,
  EngineAdapter,
  EngineConnection,
  EngineWebUi,
  ProcessCommands,
  ProcessRuntime,
} from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7BpmnDialect } from "../../src/adapters/c7/c7-bpmn-dialect.js"
import { C8BpmnDialect } from "../../src/adapters/c8/c8-bpmn-dialect.js"
import { BpmnProcessId, ElementId } from "../../src/contract/index.js"
import { CompositionRoot } from "../../src/host/composition-root.js"
import type { Credentials } from "../../src/host/connections/connection.js"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"
import { MemoryFiles } from "../model/support/memory-files.js"
import { CATALOGUE, LOCAL_TARGET } from "./support/engines.js"

const NO_LOGIN: Credentials = { kind: "none" }
const LOGIN: Credentials = { kind: "basic", username: "demo", password: "demo" }

const C7_TARGET: EngineTarget = { ...LOCAL_TARGET, name: "shop-c7" }

class RecordingAdapter implements EngineAdapter {
  readonly connections: EngineConnection[] = []
  readonly webUiUrls: string[] = []
  readonly runtimeOfIt = {} as ProcessRuntime
  readonly commandsOfIt = {} as ProcessCommands
  readonly profiles = { name: "", flavors: [], withoutFlavor: false, credentials: [] }
  readonly setups = []

  constructor(
    readonly id: string,
    readonly bpmn: BpmnDialect = new C7BpmnDialect(),
  ) {}

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
      name: this.id,
      overviewUrl: () => "",
      instanceUrl: () => "",
      definitionUrl: () => "",
    }
  }
}

const SHIPPING = [
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  ' xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"><bpmn:process id="shipping">',
  '<bpmn:serviceTask id="Activity_BookCarrier"><bpmn:extensionElements>',
  '<zeebe:taskDefinition type="book-carrier" /></bpmn:extensionElements></bpmn:serviceTask>',
  "</bpmn:process></bpmn:definitions>",
].join("")

async function implementationIn(root: CompositionRoot) {
  const { models } = root.localSources(
    new MemoryFiles({ "file:///workspace/shipping.bpmn": SHIPPING }),
  )
  const model = await models.modelOf(BpmnProcessId("shipping"))
  const element =
    model === undefined
      ? undefined
      : await models.elementIn(model, ElementId("Activity_BookCarrier"))
  return element?.configuration.implementation
}

function rootWithRecorder() {
  const c7 = new RecordingAdapter("c7")
  const c8 = new RecordingAdapter("c8")
  return { c7, c8, root: new CompositionRoot([c7, c8]) }
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

  test("hands a target to the adapter of its own engine kind only", () => {
    const { c7, c8, root } = rootWithRecorder()
    const target: EngineTarget = { ...C7_TARGET, engine: "c8" }

    expect(root.runtime(target, NO_LOGIN)).toBe(c8.runtimeOfIt)
    expect(c7.connections).toEqual([])
  })

  test("builds client credentials from the target and the stored client", () => {
    const { c8, root } = rootWithRecorder()
    const target: EngineTarget = {
      ...C7_TARGET,
      engine: "c8",
      endpoint: "https://bru-2.api.camunda.io/cluster/v2",
      auth: {
        kind: "clientCredentials",
        tokenEndpoint: "https://login.cloud.camunda.io/oauth/token",
        audience: "zeebe.camunda.io",
        scopes: ["read"],
      },
    }

    root.runtime(target, { kind: "clientCredentials", clientId: "pulse", clientSecret: "s3cret" })
    root.runtime(target, NO_LOGIN)

    expect(c8.connections.map((connection) => connection.credentials)).toEqual([
      {
        kind: "clientCredentials",
        tokenEndpoint: "https://login.cloud.camunda.io/oauth/token",
        clientId: "pulse",
        clientSecret: "s3cret",
        audience: "zeebe.camunda.io",
        scopes: ["read"],
      },
      { kind: "none" },
    ])
  })

  test("hands the adapter the token endpoint of the project file as written", () => {
    const { c8, root } = rootWithRecorder()
    const tokenEndpoint = "https://authentik.example.com/application/o/token/?tenant=shop"
    const { targets } = new TargetsParser("/work/.pulse-cli.json", CATALOGUE).parse(
      JSON.stringify({
        profiles: {
          c8: {
            url: "https://c8.example.com/v2",
            flavor: "camunda8",
            auth: { type: "clientCredentials", tokenEndpoint: ` ${tokenEndpoint} ` },
          },
        },
      }),
    )

    for (const target of targets) {
      root.runtime(target, { kind: "clientCredentials", clientId: "pulse", clientSecret: "s3cret" })
    }

    expect(c8.connections.map((connection) => connection.credentials)).toEqual([
      { kind: "clientCredentials", tokenEndpoint, clientId: "pulse", clientSecret: "s3cret" },
    ])
  })

  test("asks the adapter of a target whether it can write at all", () => {
    const readOnly = new RecordingAdapter("c8")
    const root = new CompositionRoot([
      new RecordingAdapter("c7"),
      Object.assign(readOnly, { commands: () => undefined }),
    ])

    expect(root.canWrite(C7_TARGET)).toBe(true)
    expect(root.canWrite({ ...C7_TARGET, engine: "c8" })).toBe(false)
  })

  test("reads the local models with the BPMN dialects of its adapters", async () => {
    const withC8 = new CompositionRoot([
      new RecordingAdapter("c7"),
      new RecordingAdapter("c8", new C8BpmnDialect()),
    ])

    expect(await implementationIn(withC8)).toEqual({
      kind: "workerTask",
      taskType: "book-carrier",
    })
    expect(
      await implementationIn(new CompositionRoot([new RecordingAdapter("c7")])),
    ).toBeUndefined()
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
