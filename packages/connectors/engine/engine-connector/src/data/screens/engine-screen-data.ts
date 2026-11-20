/**
 * The web app's engine screen over the engine a call resolved, in any dialect: its numbers by the
 * screens' builder (`EngineScreen` of @miragon/pulse-screens/builder) over the engine contract's
 * runtime of the engine (`runtimeOf`: c7-core's `C7Runtime` over the server's SDK wire, c8-core's
 * `C8Runtime` over its Camunda 8 wire), serialized by `ScreenJson`, the same JSON the editors'
 * adapters build from the same answers (D2). The list of processes is primary and fails the read;
 * what the engine says it is degrades to null (`info`), never a guess. Beside it the engine's own
 * web app, where the profile or the provider knows its address.
 */

import type { EngineScreenData } from "@miragon/pulse-screens"
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { buildEngineCockpitUrl, webAppUrlOf } from "../../lib/engine/cockpit-url.js"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"

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
 * The engine's own web app: a Camunda 7 engine's from the profile's `cockpitUrl` or the base its
 * provider derives from the REST root, another dialect's from the profile's `cockpitUrl` alone.
 */
function webAppOf(engine: RuntimeEngine): EngineWebAppData | null {
  const url = "client" in engine ? buildEngineCockpitUrl(engine) : webAppUrlOf(engine.cockpitUrl)
  return url === null ? null : { url, vendor: engine.provider.branding.displayName }
}

/** The engine screen of `engine`, read at `now`. */
export async function buildEngineScreenData(
  engine: RuntimeEngine,
  now: () => Date = () => new Date(),
): Promise<EngineScreenFeedData> {
  const model = await EngineScreen.read(engine.engineId, runtimeOf(engine), now)
  return { ...ScreenJson.engine(model), webApp: webAppOf(engine) }
}
