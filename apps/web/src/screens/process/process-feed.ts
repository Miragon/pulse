import type {
  InstanceListData,
  InstanceListFilterData,
  ProcessScreenData,
  VariableConditionData,
  VariableConditionKindCode,
} from "@miragon/pulse-screens"
import { instantOf } from "../../router/wall-clock.js"

/**
 * The process screen's feeds (the engine module's `SCREEN_FEEDS`): app-only reads of the engine
 * contract in every dialect, which the page's forward admits (`test/page-reads.test.ts`). The
 * process in one version, a page of its instance list, and the names of its variables, read only
 * when the reader opens the condition dialog.
 */
export const PROCESS_SCREEN_FEED = "engine_screen_process_data"
export const INSTANCES_FEED = "engine_screen_instances_data"
export const VARIABLE_NAMES_FEED = "engine_screen_variable_names_data"

/** The process screen's cache key, per engine, process and version: one read it and its Refresh share. */
export const processScreenKey = (engine: string, process: string): readonly unknown[] => [
  "web:process-screen",
  engine,
  process,
]

/** The instance list's cache key, per engine and version: its first page by its filter. */
export const instancesKey = (engine: string, definitionId: string): readonly unknown[] => [
  "web:instances",
  engine,
  definitionId,
]

/** A version's variable names' cache key: read once, when the reader first opens the dialog. */
export const variableNamesKey = (engine: string, definitionId: string): readonly unknown[] => [
  "web:variable-names",
  engine,
  definitionId,
]

/** A version in the engine's own web app: its address and its vendor's name. */
interface ProcessWebApp {
  readonly url: string
  readonly vendor: string
}

/**
 * What the process feed answers: the process screen in the JSON form of `@miragon/pulse-screens`
 * (the numbers the editors' definition view shows), and the version in the engine's web app where
 * the engine's provider knows its address.
 */
export interface ProcessScreenFeed extends ProcessScreenData {
  readonly webApp: ProcessWebApp | null
}

/** What the variable names feed answers: the version's variable names and the refused kinds. */
export interface VariableNamesFeed {
  readonly definitionId: string
  readonly names: readonly string[]
  readonly refused: readonly VariableConditionKindCode[]
}

/** A page of the instance list: the instance list's JSON form. */
export type InstancesFeed = InstanceListData

/** The feed's refusal of a process the engine has no version of: its code leads the server's text. */
const UNKNOWN_PROCESS = /^\[UNKNOWN_PROCESS\]/

/**
 * Whether the screen's read found no version of the process on its engine: a refusal no retry
 * changes, so the page neither reads it again by itself nor offers Try again.
 */
export function isUnknownProcess(error: unknown): boolean {
  return error instanceof Error && UNKNOWN_PROCESS.test(error.message)
}

/** The list feed's refusal of a condition of a kind the engine refuses. */
const REFUSED_CONDITION = /^\[REFUSED_CONDITION\]/

/** Whether a list's read refused one of its variable conditions: no retry changes it. */
export function isRefusedCondition(error: unknown): boolean {
  return error instanceof Error && REFUSED_CONDITION.test(error.message)
}

/**
 * A condition as the feed takes it: a date the dialog wrote as this browser's wall clock becomes
 * the instant it names here, with its offset (UTC), since the server reads no reader's zone; a
 * date that names its offset already, and every other value, as it is.
 */
function zoned(condition: VariableConditionData): VariableConditionData {
  return condition.as === "date" ? { ...condition, value: instantOf(condition.value) } : condition
}

/** The list feed's arguments of a version and a filter, without a cursor. */
export function instancesArgs(
  engine: string,
  definitionId: string,
  filter: InstanceListFilterData,
): Readonly<Record<string, unknown>> {
  const { scope, elementId, businessKey, variables } = filter
  return {
    engine,
    definitionId,
    scope,
    ...(elementId === undefined ? {} : { element: elementId }),
    ...(businessKey === undefined ? {} : { businessKey }),
    ...(variables === undefined ? {} : { variables: variables.map(zoned) }),
  }
}
