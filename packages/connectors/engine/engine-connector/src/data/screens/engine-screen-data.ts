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
 * 30 s per caller (`screen-floor.ts`); a screen without what the engine says it is is kept for no
 * one, so the next read asks again.
 */

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

/** The floor of the engine screen: a screen that says what the engine is stays for it. */
const engineFloor = screenFloor<EngineScreenFeedData>(({ info }) => info !== null)

/** The engine screen of `engine`: one read in the floor's 30 s, else read at `now`. */
export function buildEngineScreenData(
  engine: RuntimeEngine,
  now: () => Date = () => new Date(),
): Promise<EngineScreenFeedData> {
  return engineFloor(engine, {}, async () => {
    const model = await EngineScreen.read(engine.engineId, runtimeOf(engine), now)
    return { ...ScreenJson.engine(model), webApp: webAppOf(engine) }
  })
}
