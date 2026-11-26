/**
 * "With incident" under the cockpit's search on a real engine (#717), the checks
 * c7-runtime.engine.test.ts runs beside its seeded world. Each starts its own orders waiting at
 * their review, a search's matches with and without an open incident, the incident of a type of
 * its own and without a message (one only `withIncident` reads every one of), and deletes them
 * again. The engine's own answer is the oracle: the search's matches (its OR query, which keeps
 * them), and among them the instances the runtime holds an open incident for, in the list's order.
 * The chip counts those, and its page lists them, one row a page as all of them at once. Two engine
 * facts say why c7-core splits the search there (`searchedInstances`): the engine answers the flag
 * beside the OR query with every match, and an incident message pattern beside it misses the
 * incident without a message. Should the first fail, the engine keeps the flag beside an OR query,
 * and c7-core could send one body again.
 */

import { WORLD_ELEMENT, WORLD_PROCESS } from "@miragon/pulse-engine-core/testing"
import { expect } from "vitest"
import { buildProcessInstancesData } from "../../data/cockpit-data.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"

/** The list's order, as the cockpit sorts its instance list. */
const SORTING = [
  { sortBy: "businessKey", sortOrder: "asc" },
  { sortBy: "instanceId", sortOrder: "asc" },
] as const

/** The JSON answer of a request the check sends itself, over the REST API without the SDK. */
async function rest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? (init?.body === undefined ? "GET" : "POST")
  const response = await fetch(url, {
    method,
    ...(init?.body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }),
  })
  if (!response.ok) throw new Error(`${method} ${url}: HTTP ${response.status}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** The instances the search's own bodies find, as the engine answers them. */
interface EngineAnswer {
  /** The search's matches, by its OR query. */
  readonly matches: readonly string[]
  /** Those the runtime holds an open incident for, in the list's order. */
  readonly withIncident: readonly string[]
}

const idsOf = (rows: readonly { readonly id: string }[]) => rows.map(({ id }) => id)

async function engineAnswer(url: string, term: string, scope: object): Promise<EngineAnswer> {
  const orQueries = [{ businessKeyLike: `%${term}%`, processInstanceIds: [term] }]
  const matches = idsOf(await rest(`${url}/process-instance`, { body: { ...scope, orQueries } }))
  const flagged = matches.length === 0 ? [] : await withIncidentAmong(url, matches)
  const sorted =
    flagged.length === 0
      ? []
      : await rest<{ id: string }[]>(`${url}/process-instance`, {
          body: { processInstanceIds: flagged, sorting: SORTING },
        })
  return { matches, withIncident: idsOf(sorted) }
}

async function withIncidentAmong(url: string, ids: readonly string[]): Promise<string[]> {
  const query = `withIncident=true&processInstanceIds=${ids.join(",")}`
  return idsOf(await rest(`${url}/process-instance?${query}`))
}

/** An order of the world's latest version waiting at its review, without a key if none: its id. */
async function startOrder(url: string, businessKey?: string): Promise<string> {
  const started = await rest<{ id: string }>(
    `${url}/process-definition/key/${WORLD_PROCESS.order}/start`,
    { body: { businessKey, variables: { route: { value: "review", type: "String" } } } },
  )
  return started.id
}

/** An open incident of a type of its own and without a message at the review `id` waits at. */
async function raiseIncident(url: string, id: string): Promise<void> {
  const element = WORLD_ELEMENT.reviewOrder
  const [execution] = await rest<{ id: string }[]>(
    `${url}/execution?processInstanceId=${id}&activityId=${element}`,
  )
  if (execution === undefined) throw new Error(`instance ${id} waits at no ${element}`)
  await rest(`${url}/execution/${execution.id}/create-incident`, {
    body: { incidentType: "pulseSearchCase", configuration: "the cockpit search's case" },
  })
}

/**
 * The orders of a check: `quiet` and `failing` match the business key `MCP-SEARCH`, `holder` and
 * `holderQuiet` hold `failing`'s id in their business keys; `keyless` has none, and `keylessHolder`
 * holds its id in its own; `failing`, `holder`, `keyless` and `keylessHolder` have an open incident.
 * Deleted again by `remove`.
 */
interface Orders {
  readonly quiet: string
  readonly failing: string
  readonly holder: string
  readonly holderQuiet: string
  readonly keyless: string
  readonly keylessHolder: string
}

async function startOrders(url: string): Promise<Orders> {
  const quiet = await startOrder(url, "MCP-SEARCH-QUIET")
  const failing = await startOrder(url, "MCP-SEARCH-FAILING")
  const holder = await startOrder(url, `MCP-HOLDS-${failing}`)
  const holderQuiet = await startOrder(url, `MCP-HOLDS-${failing}-QUIET`)
  const keyless = await startOrder(url)
  const keylessHolder = await startOrder(url, `MCP-HOLDS-${keyless}`)
  for (const id of [failing, holder, keyless, keylessHolder]) await raiseIncident(url, id)
  return { quiet, failing, holder, holderQuiet, keyless, keylessHolder }
}

async function remove(url: string, orders: Orders): Promise<void> {
  for (const id of Object.values(orders)) {
    await rest(`${url}/process-instance/${id}?skipCustomListeners=true`, { method: "DELETE" })
  }
}

/** Runs `check` over freshly started orders and deletes them, whether it passes or not. */
function withOrders(check: (url: string, engine: ResolvedEngine, orders: Orders) => Promise<void>) {
  return async (url: string, engine: ResolvedEngine) => {
    const orders = await startOrders(url)
    try {
      await check(url, engine, orders)
    } finally {
      await remove(url, orders)
    }
  }
}

/** The cockpit's list of `term` with the chip on, scoped as `scope` names, and its pages one by one. */
async function chipOn(
  engine: ResolvedEngine,
  term: string,
  scope: { processDefinitionKey?: string },
) {
  const read = (paging: { firstResult?: number; maxResults?: number }) =>
    buildProcessInstancesData(engine.client, engine.engineId, {
      ...scope,
      search: term,
      withIncidents: true,
      ...paging,
    })
  const whole = await read({})
  const pages: string[] = []
  for (let first = 0; first <= whole.totalCount; first += 1) {
    pages.push(...idsOf((await read({ firstResult: first, maxResults: 1 })).instances))
  }
  return { whole, pages }
}

/** The chip, its page and its pages hold the engine's answer of the search's matches with one. */
async function holdsTheEngineAnswer(
  url: string,
  engine: ResolvedEngine,
  term: string,
  scope: { processDefinitionKey?: string },
): Promise<EngineAnswer> {
  const answer = await engineAnswer(url, term, scope)
  const { whole, pages } = await chipOn(engine, term, scope)
  expect(whole).toMatchObject({
    totalCount: answer.withIncident.length,
    allCount: answer.matches.length,
    withIncidentCount: answer.withIncident.length,
  })
  expect(idsOf(whole.instances)).toEqual(answer.withIncident)
  expect(whole.instances.every(({ hasIncident }) => hasIncident)).toBe(true)
  expect(pages).toEqual(answer.withIncident)
  return answer
}

async function byBusinessKey(url: string, engine: ResolvedEngine, orders: Orders): Promise<void> {
  const scope = { processDefinitionKey: WORLD_PROCESS.order }
  const term = "MCP-SEARCH"
  const answer = await holdsTheEngineAnswer(url, engine, term, scope)
  // A match without an incident beside one with: the chip lists the second alone.
  expect(new Set(answer.matches)).toEqual(new Set([orders.quiet, orders.failing]))
  expect(answer.withIncident).toEqual([orders.failing])
  // The engine facts behind the split: the flag beside the OR query counts every match, and a
  // message pattern beside it misses the incident without a message.
  const orQueries = [{ businessKeyLike: `%${term}%`, processInstanceIds: [term] }]
  const count = async (body: object) =>
    (await rest<{ count: number }>(`${url}/process-instance/count`, { body })).count
  expect(await count({ ...scope, withIncident: true, orQueries })).toBe(answer.matches.length)
  expect(await count({ ...scope, incidentMessageLike: "%", orQueries })).toBe(0)
}

async function byInstanceId(url: string, engine: ResolvedEngine, orders: Orders): Promise<void> {
  const answer = await holdsTheEngineAnswer(url, engine, orders.failing, {})
  // The id names one instance, two business keys hold it: the union of both, never one half.
  expect(new Set(answer.matches)).toEqual(
    new Set([orders.failing, orders.holder, orders.holderQuiet]),
  )
  expect(new Set(answer.withIncident)).toEqual(new Set([orders.failing, orders.holder]))
}

/**
 * An id whose instance has no business key: the engine sorts it where its database puts NULL, first
 * (H2) or last, and a page one row at a time places it so, before the row read early or after it.
 */
async function byKeylessInstanceId(
  url: string,
  engine: ResolvedEngine,
  orders: Orders,
): Promise<void> {
  const answer = await holdsTheEngineAnswer(url, engine, orders.keyless, {})
  const both = new Set([orders.keyless, orders.keylessHolder])
  expect([new Set(answer.matches), new Set(answer.withIncident)]).toEqual([both, both])
}

/** Each check by its name, over the seeded engine at `url` as the server resolves it. */
export const COCKPIT_SEARCH_CHECKS: ReadonlyArray<
  readonly [string, (url: string, engine: ResolvedEngine) => Promise<void>]
> = [
  [
    "search: With incident under a business key search counts and lists only the matches with an open incident",
    withOrders(byBusinessKey),
  ],
  [
    "search: With incident under an instance id lists the instance and the business keys holding it, in the list's order",
    withOrders(byInstanceId),
  ],
  [
    "search: With incident under the id of an instance without a business key lists it where the engine sorts it",
    withOrders(byKeylessInstanceId),
  ],
]
