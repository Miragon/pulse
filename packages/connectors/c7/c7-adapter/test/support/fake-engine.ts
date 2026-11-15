import type { ProcessCommands, ProcessRuntime } from "@miragon/pulse-engine-core"
import { C7ProcessCommands } from "../../src/c7-process-commands.js"
import { C7ProcessRuntime } from "../../src/c7-process-runtime.js"
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

export function fakeRuntime(routes: readonly RestRoute[]): {
  runtime: ProcessRuntime
  engine: FakeEngineRest
} {
  const engine = fakeEngineRest(routes)
  return { runtime: C7ProcessRuntime.create(new RestEngineClient(httpOver(engine))), engine }
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
