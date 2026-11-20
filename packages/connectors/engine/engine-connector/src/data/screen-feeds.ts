import { ENGINE_SCREEN_PROCESSES_DATA } from "../tool-names.js"
import { EVERY_DIALECT } from "../view-models.dialects.js"
import { type ContractFeed, contractFeed } from "./feeds.js"
import { buildEngineScreenData } from "./screens/engine-screen-data.js"

/**
 * The feeds of the web app's own screens (D10): app-only reads of the engine contract in every
 * dialect, the one engine their `engine` parameter resolves to (`resolveRuntimeEngine`), whose
 * numbers the screens' builder makes. No view of the cockpit reads them, so they are no route's:
 * a page's screen reads a screen feed, and it is never a second view. `widget-tools/data-feeds.ts`
 * registers them beside `DATA_FEEDS`, app-only and read-only, so the web app's forward admits a
 * page's call to them.
 */

const engineScreenFeed = contractFeed({
  name: ENGINE_SCREEN_PROCESSES_DATA,
  title: "Engine screen data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's engine screen: the engine's product and each process's latest version, running instances and instances with incident over every version.",
  dialects: EVERY_DIALECT,
  shape: {},
  engines: "contract",
  read: (_, engine) => buildEngineScreenData(engine),
})

/** Every feed of the web app's screens, in registration order. */
export const SCREEN_FEEDS: readonly ContractFeed[] = [engineScreenFeed]
