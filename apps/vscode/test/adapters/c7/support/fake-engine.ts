import type { ProcessCommands, ProcessRuntime } from "../../../../src/contract/index.js"
import { C7ProcessCommands } from "../../../../src/adapters/c7/c7-process-commands.js"
import { C7ProcessRuntime } from "../../../../src/adapters/c7/c7-process-runtime.js"
import {
  EngineHttp,
  RestEngineClient,
  RestEngineWriter,
  type InspectView,
} from "../../../../src/adapters/c7/engine-rest/index.js"
import {
  fakeEngineRest,
  REST_URL,
  type FakeEngineRest,
  type RestRoute,
} from "./fake-engine-rest.js"

export type Snapshots = Readonly<Record<string, string>>

class SnapshotEngineClient extends RestEngineClient {
  constructor(
    http: EngineHttp,
    private readonly snapshots: Snapshots,
  ) {
    super(http)
  }

  override inspect(instanceId: string): Promise<InspectView | undefined> {
    const snapshot = this.snapshots[instanceId]
    return snapshot === undefined
      ? super.inspect(instanceId)
      : Promise.resolve(JSON.parse(snapshot) as InspectView)
  }
}

export function httpOver(engine: FakeEngineRest, writes = false): EngineHttp {
  return new EngineHttp({ url: REST_URL, credentials: { kind: "none" }, writes, send: engine.send })
}

export function fakeRuntime(
  routes: readonly RestRoute[],
  snapshots: Snapshots = {},
): { runtime: ProcessRuntime; engine: FakeEngineRest } {
  const engine = fakeEngineRest(routes)
  const client = new SnapshotEngineClient(httpOver(engine), snapshots)
  return { runtime: C7ProcessRuntime.create(client), engine }
}

export function fakeCommands(
  routes: readonly RestRoute[],
  snapshots: Snapshots = {},
): { commands: ProcessCommands; engine: FakeEngineRest } {
  const engine = fakeEngineRest(routes)
  const writer = new RestEngineWriter(httpOver(engine, true))
  const client = new SnapshotEngineClient(httpOver(engine), snapshots)
  return { commands: new C7ProcessCommands(writer, client), engine }
}
