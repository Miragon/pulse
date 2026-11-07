import { C7Adapter } from "../../src/adapters/c7/index.js"
import { C8Adapter } from "../../src/adapters/c8/index.js"
import type {
  EngineAdapter,
  EngineConnection,
  EngineCredentials,
  ProcessCommands,
  ProcessRuntime,
} from "../../src/contract/index.js"
import { FakeEngine, FakeWorld } from "../../src/contract/fake/index.js"

export interface DevEngine {
  readonly name: string
  readonly runtime: ProcessRuntime
  readonly commands: ProcessCommands | undefined
}

function camunda8Credentials(): EngineCredentials {
  const { PULSE_DEV_USERNAME, PULSE_DEV_PASSWORD, PULSE_DEV_TOKEN_ENDPOINT } = process.env
  const { PULSE_DEV_CLIENT_ID, PULSE_DEV_CLIENT_SECRET, PULSE_DEV_AUDIENCE } = process.env
  if (PULSE_DEV_USERNAME !== undefined && PULSE_DEV_PASSWORD !== undefined) {
    return { kind: "basic", username: PULSE_DEV_USERNAME, password: PULSE_DEV_PASSWORD }
  }
  return PULSE_DEV_TOKEN_ENDPOINT === undefined
    ? { kind: "none" }
    : {
        kind: "clientCredentials",
        tokenEndpoint: PULSE_DEV_TOKEN_ENDPOINT,
        clientId: PULSE_DEV_CLIENT_ID ?? "",
        clientSecret: PULSE_DEV_CLIENT_SECRET ?? "",
        ...(PULSE_DEV_AUDIENCE === undefined ? {} : { audience: PULSE_DEV_AUDIENCE }),
      }
}

function engineOn(adapter: EngineAdapter, name: string, connection: EngineConnection): DevEngine {
  return { name, runtime: adapter.runtime(connection), commands: adapter.commands(connection) }
}

export function createDevEngine(url: string): DevEngine {
  if (url === "fake") {
    const engine = new FakeEngine(FakeWorld.seed().state)
    return { name: "fake", runtime: engine, commands: engine }
  }
  return process.env.PULSE_DEV_FLAVOR === "camunda8"
    ? engineOn(new C8Adapter(), "local-camunda8", {
        endpoint: url,
        credentials: camunda8Credentials(),
      })
    : engineOn(new C7Adapter(), "local-operaton", { endpoint: url, credentials: { kind: "none" } })
}
