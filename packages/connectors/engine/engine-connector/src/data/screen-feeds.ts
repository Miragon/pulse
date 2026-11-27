import { z } from "zod"
import { VariableConditionTypes } from "@miragon/pulse-screens"
import {
  ENGINE_SCREEN_FIND_DATA,
  ENGINE_SCREEN_INCIDENT_TEXT_DATA,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_INSTANCES_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
  ENGINE_SCREEN_VARIABLE_NAMES_DATA,
  ENGINE_SCREEN_VERDICT_DATA,
} from "../tool-names.js"
import { EVERY_DIALECT } from "../view-models.dialects.js"
import { type ContractFeed, contractFeed, type DataFeed, dataFeed } from "./feeds.js"
import { buildEngineScreenData } from "./screens/engine-screen-data.js"
import { buildFindData } from "./screens/find-data.js"
import { buildIncidentTextData } from "./screens/incident-text-data.js"
import { buildInstanceListData } from "./screens/instance-list-data.js"
import { buildInstanceScreenData } from "./screens/instance-screen-data.js"
import { buildProcessScreenData } from "./screens/process-screen-data.js"
import { buildVariableNamesData } from "./screens/variable-names-data.js"
import { buildEngineVerdictData } from "./screens/verdict-data.js"

/**
 * The feeds of the web app's own screens (D10): an engine's processes, a process in one version,
 * its instance list and the names of its variables, an instance and the text of one of its root
 * incidents, what the search finds on one engine, app-only reads of the engine contract in every dialect, the one engine their `engine`
 * parameter resolves to (`resolveRuntimeEngine`), whose numbers the screens' builder makes; beside
 * them a Camunda 7 engine's live verdict (c7-core's), which the engine screen's bar and the start
 * page show, a read of the Camunda 7 REST API alone (`resolveEngine`). No
 * view of the cockpit reads them, so they are no route's: a page's screen reads a screen feed, and
 * it is never a second view. `widget-tools/data-feeds.ts` registers them beside `DATA_FEEDS`,
 * app-only and read-only, so the web app's forward admits a page's call to them. The reads that
 * load the engine's database (the engine's processes with their counts, a version's element
 * statistics, an instance list's search and history counts, a version's variable names, a search,
 * the verdict's incident scan beside the engine screen's own read) stand on a floor of 30 s per
 * caller and arguments, as a board's build does (`screens/screen-floor.ts`); an instance and an
 * incident's text run none of them.
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

/** A date as an instant: its wall clock and its offset, which the builder needs (no zone of the server's). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** A number as an engine compares one: an optional minus, digits, an optional fraction. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

/** What a value of each type a condition compares as must look like; text and null take any. */
const VALUE_RULES: Readonly<Record<string, RegExp>> = {
  number: NUMBER,
  boolean: /^(?:true|false)$/,
  date: INSTANT,
}

const variableCondition = z
  .strictObject({
    name: z.string().min(1).describe("The variable's name, case sensitive."),
    operator: z
      .enum(["equals", "notEquals", "like", "greaterThan", "lessThan"])
      .describe("How the variable compares with the value; like takes * as a wildcard."),
    value: z.string().describe("The value, as text; a date an instant with its offset."),
    as: z
      .enum(["text", "number", "boolean", "date", "null"])
      .optional()
      .describe("The type the value compares as; by the value and the operator without it."),
  })
  .refine(
    (condition) =>
      condition.operator === "like" ||
      (VALUE_RULES[VariableConditionTypes.of(condition)]?.test(condition.value) ?? true),
    { message: "The value does not read as the type it compares as (a date needs its offset)." },
  )

const processScreenFeed = contractFeed({
  name: ENGINE_SCREEN_PROCESS_DATA,
  title: "Process screen data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's process screen: a process in one version with every version's counts, the counts on the version's diagram, its call targets and the notice that older versions still run.",
  dialects: EVERY_DIALECT,
  shape: {
    process: z.string().min(1).describe("The process's BPMN process ID."),
    tenantId: z.string().min(1).optional().describe("The process's tenant, if it has one."),
    version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The number of the version to show; the latest without it."),
  },
  engines: "contract",
  read: ({ process, tenantId, version }, engine) =>
    buildProcessScreenData(engine, { process, tenantId, version }),
})

const instancesFeed = contractFeed({
  name: ENGINE_SCREEN_INSTANCES_DATA,
  title: "Instance list data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's process screen: a page of 50 instances of one version by its filter, and on the first page the counts of its scopes.",
  dialects: EVERY_DIALECT,
  shape: {
    definitionId: z.string().min(1).describe("The version's id."),
    scope: z
      .enum(["running", "withIncident", "ended", "all"])
      .describe("Which instances: running, running with an open incident, ended, or all."),
    element: z.string().min(1).optional().describe("An element the instances are active at."),
    businessKey: z.string().min(1).optional().describe("The exact business key."),
    variables: z
      .array(variableCondition)
      .max(5)
      .optional()
      .describe("Variable conditions, all of which hold."),
    after: z.string().min(1).optional().describe("The cursor of the page before, from its next."),
  },
  engines: "contract",
  read: ({ definitionId, scope, element, businessKey, variables, after }, engine) =>
    buildInstanceListData(engine, { definitionId, scope, element, businessKey, variables, after }),
})

const variableNamesFeed = contractFeed({
  name: ENGINE_SCREEN_VARIABLE_NAMES_DATA,
  title: "Variable names data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's process screen: the names of a version's variables and the kinds of condition the engine refuses.",
  dialects: EVERY_DIALECT,
  shape: { definitionId: z.string().min(1).describe("The version's id.") },
  engines: "contract",
  read: ({ definitionId }, engine) => buildVariableNamesData(engine, definitionId),
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

const findFeed = contractFeed({
  name: ENGINE_SCREEN_FIND_DATA,
  title: "Find data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's search: the process instance with this id and up to 20 with this exact business key, running and ended, on one engine.",
  dialects: EVERY_DIALECT,
  shape: {
    text: z.string().trim().min(1).max(256).describe("An instance's id or its exact business key."),
  },
  engines: "contract",
  read: ({ text }, engine) => buildFindData(engine, text),
})

const verdictFeed = dataFeed({
  name: ENGINE_SCREEN_VERDICT_DATA,
  title: "Engine verdict data (internal)",
  description:
    "Internal JSON feed (no UI) for the web app's engine screen and start page: a Camunda 7 engine's live verdict, ok, warning or critical, over its open root incidents.",
  dialects: ["c7"],
  shape: {},
  read: (_, engine, { healthThresholds }) => buildEngineVerdictData(engine, healthThresholds),
})

/** Every feed of the web app's screens, in registration order. */
export const SCREEN_FEEDS: readonly (ContractFeed | DataFeed)[] = [
  engineScreenFeed,
  processScreenFeed,
  instancesFeed,
  variableNamesFeed,
  instanceScreenFeed,
  incidentTextFeed,
  findFeed,
  verdictFeed,
]
