import { z } from "zod"
import {
  ENGINE_SCREEN_INCIDENT_TEXT_DATA,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
} from "../tool-names.js"
import { EVERY_DIALECT } from "../view-models.dialects.js"
import { type ContractFeed, contractFeed } from "./feeds.js"
import { buildEngineScreenData } from "./screens/engine-screen-data.js"
import { buildIncidentTextData } from "./screens/incident-text-data.js"
import { buildInstanceScreenData } from "./screens/instance-screen-data.js"

/**
 * The feeds of the web app's own screens (D10): an engine's processes, an instance and the text of
 * one of its root incidents, app-only reads of the engine contract in every dialect, the one engine
 * their `engine` parameter resolves to (`resolveRuntimeEngine`), whose numbers the screens' builder
 * makes. No view of the cockpit reads them, so they are no route's: a page's screen reads a screen
 * feed, and it is never a second view. `widget-tools/data-feeds.ts` registers them beside
 * `DATA_FEEDS`, app-only and read-only, so the web app's forward admits a page's call to them. No
 * floor of 30 s per caller holds them, as it holds a board's: none of them runs a read that loads
 * the engine's database (element statistics, history counts, a search across instances).
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

const instanceScreenFeed = contractFeed({
  name: ENGINE_SCREEN_INSTANCE_DATA,
  title: "Instance screen data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's instance screen: one process instance, running or ended, with its root incidents and those of the instances it called, where it waits, its path, its variables and its diagram's markers.",
  dialects: EVERY_DIALECT,
  shape: { instance: z.string().min(1).describe("The process instance's id.") },
  engines: "contract",
  read: ({ instance }, engine) => buildInstanceScreenData(engine, instance),
})

const incidentTextFeed = contractFeed({
  name: ENGINE_SCREEN_INCIDENT_TEXT_DATA,
  title: "Incident text data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's instance screen: a root incident's stack trace or error message, with the line its root cause stands on.",
  dialects: EVERY_DIALECT,
  shape: { incident: z.string().min(1).describe("The root incident's id.") },
  engines: "contract",
  read: ({ incident }, engine) => buildIncidentTextData(engine, incident),
})

/** Every feed of the web app's screens, in registration order. */
export const SCREEN_FEEDS: readonly ContractFeed[] = [
  engineScreenFeed,
  instanceScreenFeed,
  incidentTextFeed,
]
