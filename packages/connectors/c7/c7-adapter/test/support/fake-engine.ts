import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import { C7Adapter } from "../../src/c7-adapter.js"
import { C7ProcessCommands } from "../../src/c7-process-commands.js"
import { EngineHttp, RestEngineClient, RestEngineWriter } from "../../src/engine-rest/index.js"
import {
  fakeEngineRest,
  REST_URL,
  type FakeEngineRest,
  type RestRoute,
} from "./fake-engine-rest.js"

export function httpOver(engine: FakeEngineRest, writes = false): EngineHttp {
  return new EngineHttp({ url: REST_URL, credentials: { kind: "none" }, writes, send: engine.send })
}

export function runtimeOver(engine: FakeEngineRest): ProcessRuntime {
  return new C7Adapter(engine.send).runtime({ endpoint: REST_URL, credentials: { kind: "none" } })
}

export function fakeRuntime(routes: readonly RestRoute[]): {
  runtime: ProcessRuntime
  engine: FakeEngineRest
} {
  const engine = fakeEngineRest(routes)
  return { runtime: runtimeOver(engine), engine }
}

export function fakeCommands(
  routes: readonly RestRoute[],
  writes = true,
): { commands: ProcessCommands; engine: FakeEngineRest } {
  const engine = fakeEngineRest(routes)
  const writer = new RestEngineWriter(httpOver(engine, writes))
  const client = new RestEngineClient(httpOver(engine))
  return { commands: new C7ProcessCommands(writer, client), engine }
}
