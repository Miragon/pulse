import type {
  InstanceListFilterData,
  InstanceScopeCode,
  ProcessFilterData,
  VariableConditionData,
  VariableOperatorCode,
  VariableValueTypeCode,
} from "@miragon/pulse-screens"
import { instantOf, wallClockOf } from "./wall-clock.js"

/*
 * The state of the page's own screens that rides in their address's query (the plan's address
 * scheme), each both ways, a value the page does not read left out, so the canonical address drops
 * it, and the defaults left out too. The engine screen's list filter: `scope=incident` and `q`. The
 * instance screen's tab: `tab`. The process screen beside the path of the process: `tenant`, the
 * tenant of the process (none for the process without a tenant, F17), `version`, the number of the
 * version shown (none for the latest), and the instance list's filter, `scope`
 * (running, the default, left out), `element`, `key` (the exact business key) and `var` once per
 * variable condition, `name~operator~value` (`operator.type` where the condition names the type it
 * compares as, a `~` or `%` of the name escaped, a date the instant it names with its offset, read
 * on this browser's wall clock; an old address's wall clock read as it is and written as its
 * instant).
 */

/** A tab of the instance screen, in the editors' order: its path, its incidents, its waits, its variables. */
export type InstanceTab = "history" | "incidents" | "waiting" | "variables"

/** The instance screen's tabs, in their order. */
export const INSTANCE_TABS: readonly InstanceTab[] = [
  "history",
  "incidents",
  "waiting",
  "variables",
]

/** The engine screen's list without a filter: every process, no search. */
export const EVERY_PROCESS: ProcessFilterData = { scope: "all" }

/** The engine screen's query: its scope (the processes with an instance with incident) and search. */
const SCREEN_QUERY = { scope: "scope", withIncident: "incident", search: "q" } as const

/** The instance screen's query: its tab. */
const TAB_QUERY = "tab"

/** The instance screen's tab an address's query names; none for a tab it does not know. */
export function tabOf(search: string): InstanceTab | undefined {
  const tab = new URLSearchParams(search).get(TAB_QUERY)
  return INSTANCE_TABS.find((known) => known === tab)
}

/** The instance screen's query: its tab, where the reader picked one. */
export function tabQueryOf(tab: InstanceTab | undefined): URLSearchParams {
  return new URLSearchParams(tab === undefined ? [] : [[TAB_QUERY, tab]])
}

/**
 * The engine screen's filter an address's query names: `scope=incident` the processes with an
 * instance with incident, `q` the search, trimmed as the search field applies it; any other value
 * the default.
 */
export function filterOf(search: string): ProcessFilterData {
  const query = new URLSearchParams(search)
  const scope = query.get(SCREEN_QUERY.scope) === SCREEN_QUERY.withIncident ? "withIncident" : "all"
  const text = query.get(SCREEN_QUERY.search)?.trim() ?? ""
  return text === "" ? { scope } : { scope, search: text }
}

/** The engine screen's query: its list's filter, the defaults left out. */
export function filterQueryOf(filter: ProcessFilterData): URLSearchParams {
  const query = new URLSearchParams()
  if (filter.scope === "withIncident") query.set(SCREEN_QUERY.scope, SCREEN_QUERY.withIncident)
  const text = filter.search?.trim() ?? ""
  if (text !== "") query.set(SCREEN_QUERY.search, text)
  return query
}

/**
 * The process screen's query: the version's number, the list's scope (running, the default, left
 * out), the element it is filtered to, the exact business key and each variable condition.
 */
const PROCESS_QUERY = {
  tenant: "tenant",
  version: "version",
  scope: "scope",
  element: "element",
  businessKey: "key",
  variable: "var",
} as const

/** A scope of the process screen's list as the address spells it; running is the default. */
const SCOPE_WORDS: Readonly<Record<InstanceScopeCode, string>> = {
  running: "running",
  withIncident: "incident",
  ended: "ended",
  all: "all",
}

/** The process screen's list without a filter: the running instances. */
export const RUNNING_LIST: InstanceListFilterData = { scope: "running" }

/** The operators and value types a variable condition of the address names. */
const OPERATORS: readonly VariableOperatorCode[] = [
  "equals",
  "notEquals",
  "like",
  "greaterThan",
  "lessThan",
]
const VALUE_TYPES: readonly VariableValueTypeCode[] = ["text", "number", "boolean", "date", "null"]

/** The most variable conditions a list takes (the blocks' `VariableDraft.MAX_CONDITIONS`). */
const MAX_CONDITIONS = 5

/** The separator of a condition's parts in the address: `name~operator.type~value`. */
const PART = "~"

/** A name of the address's condition: `%` and the separator escaped, so any name rides in it. */
const escapedName = (name: string): string => name.replaceAll("%", "%25").replaceAll(PART, "%7E")

/** A name as the condition holds it, or undefined for an escape the page never writes. */
function nameOf(written: string): string | undefined {
  try {
    return decodeURIComponent(written)
  } catch {
    return undefined
  }
}

/**
 * A variable condition as the address writes it: `name~operator~value`, `operator.type` for a type,
 * a date the instant it names here (`wall-clock.ts`).
 */
function conditionText({ name, operator, value, as }: VariableConditionData): string {
  const how = as === undefined ? operator : `${operator}.${as}`
  return [escapedName(name), how, as === "date" ? instantOf(value) : value].join(PART)
}

/** A variable condition of the address, or undefined for one the page does not read. */
function conditionOf(text: string): VariableConditionData | undefined {
  const [written = "", how = "", ...rest] = text.split(PART)
  const name = nameOf(written)
  const [operator, as, ...more] = how.split(".")
  const known = OPERATORS.find((candidate) => candidate === operator)
  const type = VALUE_TYPES.find((candidate) => candidate === as)
  const typed = as === undefined || type !== undefined
  if (name === undefined || name === "" || known === undefined || !typed || more.length > 0) {
    return undefined
  }
  if (rest.length === 0) return undefined
  const value = rest.join(PART)
  const condition = { name, operator: known, value: type === "date" ? wallClockOf(value) : value }
  return type === undefined ? condition : { ...condition, as: type }
}

/** A version's number from the address: a whole number from 1 on, else none (the latest). */
function versionOf(text: string | null): number | undefined {
  return text !== null && /^[1-9]\d{0,8}$/.test(text) ? Number(text) : undefined
}

/**
 * The process screen's state its address carries: the process's tenant, the version's number and
 * the list's filter.
 */
export interface ProcessState {
  readonly tenantId?: string
  readonly version?: number
  readonly filter: InstanceListFilterData
}

/** The tenant an address's query names; none for no tenant or an empty one. */
function tenantOf(query: URLSearchParams): { readonly tenantId?: string } {
  const tenant = query.get(PROCESS_QUERY.tenant) ?? ""
  return tenant === "" ? {} : { tenantId: tenant }
}

/**
 * The process screen's state from an address's query: the version's number, the list's scope (any
 * word but the scopes' `scope`, its default), the element, the exact business key, at most five
 * variable conditions; a value the page does not read is left out.
 */
export function processStateOf(search: string, scope: InstanceScopeCode): ProcessState {
  const query = new URLSearchParams(search)
  const version = versionOf(query.get(PROCESS_QUERY.version))
  const word = query.get(PROCESS_QUERY.scope)
  const named = (Object.keys(SCOPE_WORDS) as InstanceScopeCode[]).find(
    (code) => SCOPE_WORDS[code] === word,
  )
  const element = query.get(PROCESS_QUERY.element) ?? ""
  const businessKey = query.get(PROCESS_QUERY.businessKey)?.trim() ?? ""
  const variables = query
    .getAll(PROCESS_QUERY.variable)
    .flatMap((text) => conditionOf(text) ?? [])
    .slice(0, MAX_CONDITIONS)
  const filter: InstanceListFilterData = {
    scope: named ?? scope,
    ...(element === "" ? {} : { elementId: element }),
    ...(businessKey === "" ? {} : { businessKey }),
    ...(variables.length === 0 ? {} : { variables }),
  }
  return { ...tenantOf(query), ...(version === undefined ? {} : { version }), filter }
}

/**
 * The process screen's query: its tenant where it has one, its version and its list's filter, the
 * defaults left out.
 */
export function processQueryOf({ tenantId, version, filter }: ProcessState): URLSearchParams {
  const query = new URLSearchParams()
  if (tenantId !== undefined) query.set(PROCESS_QUERY.tenant, tenantId)
  if (version !== undefined) query.set(PROCESS_QUERY.version, String(version))
  if (filter.scope !== RUNNING_LIST.scope) {
    query.set(PROCESS_QUERY.scope, SCOPE_WORDS[filter.scope])
  }
  if (filter.elementId !== undefined) query.set(PROCESS_QUERY.element, filter.elementId)
  const key = filter.businessKey?.trim() ?? ""
  if (key !== "") query.set(PROCESS_QUERY.businessKey, key)
  for (const condition of filter.variables ?? []) {
    query.append(PROCESS_QUERY.variable, conditionText(condition))
  }
  return query
}
