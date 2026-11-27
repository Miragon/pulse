/**
 * The web app's engine screen over the engine a call resolved, in any dialect: its numbers by the
 * screens' builder (`EngineScreen` of @miragon/pulse-screens/builder) over the engine contract's
 * runtime of the engine (`runtimeOf`: c7-core's `C7Runtime` over the server's SDK wire, c8-core's
 * `C8Runtime` over its Camunda 8 wire), serialized by `ScreenJson`, the same JSON the editors'
 * adapters build from the same answers (D2). The list of processes is primary and fails the read;
 * what the engine says it is degrades to null (`info`), never a guess. Beside it the engine's own
 * web app, where the profile or the provider knows its address. Its reads load the engine's
 * database (Camunda 7's definition statistics over every running instance, a Camunda 8 cluster's
 * incident search per process with an instance with incident), so the screen stands on the floor of
 * 30 s per caller (`screen-floor.ts`), part by part: its list of processes on one floor
 * (`readEngineProcesses`, which the verdict reads its root incidents from), what the engine says it
 * is on another. Each part stays for its 30 s once the engine gave it, whatever the other did, so
 * a screen without what the engine says it is asks the engine again for that alone, and the
 * verdict after it asks for no second statistics; a part the engine did not give is kept for no
 * one.
 */

import type { DefinitionSummary, EngineInfo } from "@miragon/pulse-engine-core"
import type { EngineScreenData } from "@miragon/pulse-screens"
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { buildEngineCockpitUrl, webAppUrlOf } from "../../lib/engine/cockpit-url.js"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { screenFloor } from "./screen-floor.js"

/** An engine's own web app: its address and its vendor's name, which the link names. */
interface EngineWebAppData {
  readonly url: string
  readonly vendor: string
}

/** The engine screen's feed: the screen's JSON form and the engine's own web app, null without one. */
export interface EngineScreenFeedData extends EngineScreenData {
  readonly webApp: EngineWebAppData | null
}

/**
 * The engine's own web app, by its name (the provider's, else its vendor's): a Camunda 7 engine's
 * from the profile's `cockpitUrl` or the base its provider derives from the REST root, another
 * dialect's from the profile's `cockpitUrl` alone (a Camunda 8 cluster's Operate).
 */
function webAppOf(engine: RuntimeEngine): EngineWebAppData | null {
  const url = "client" in engine ? buildEngineCockpitUrl(engine) : webAppUrlOf(engine.cockpitUrl)
  const { webApp, displayName } = engine.provider.branding
  return url === null ? null : { url, vendor: webApp ?? displayName }
}

/** An engine's list of processes as the screens' builder takes it, and when it was read. */
interface EngineProcesses {
  readonly asOf: Date
  readonly definitions: readonly DefinitionSummary[]
}

/** The floor of an engine's list of processes: every list the engine gave stays for it. */
const processesFloor = screenFloor<EngineProcesses>()

/** The floor of what an engine says it is: what it said stays; where it said nothing, nothing. */
const infoFloor = screenFloor<EngineInfo>()

/**
 * The list of processes of `engine` with their counts (Camunda 7's definition statistics with the
 * root incidents, a Camunda 8 cluster's incident search per process in trouble), read at `now`:
 * one read in the floor's 30 s, which the engine screen and the verdict share.
 */
export function readEngineProcesses(
  engine: RuntimeEngine,
  now: () => Date = () => new Date(),
): Promise<EngineProcesses> {
  return processesFloor(engine, {}, async () => {
    const asOf = now()
    return { asOf, definitions: await runtimeOf(engine).listDefinitions() }
  })
}

/** What `engine` says it is, one read in the floor's 30 s; nothing where it says nothing. */
function readEngineInfo(engine: RuntimeEngine): Promise<EngineInfo | undefined> {
  return infoFloor(engine, {}, () => runtimeOf(engine).describeEngine()).catch(() => undefined)
}

/**
 * The engine screen of `engine` from its parts, each on its floor: its list of processes, read at
 * `now` (the screen's time), and beside it what the engine says it is.
 */
export async function buildEngineScreenData(
  engine: RuntimeEngine,
  now: () => Date = () => new Date(),
): Promise<EngineScreenFeedData> {
  const [{ asOf, definitions }, info] = await Promise.all([
    readEngineProcesses(engine, now),
    readEngineInfo(engine),
  ])
  const model = EngineScreen.of({ engine: engine.engineId, asOf, definitions, info })
  return { ...ScreenJson.engine(model), webApp: webAppOf(engine) }
}
