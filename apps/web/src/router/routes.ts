import type { InstanceListFilterData, ProcessFilterData } from "@miragon/pulse-screens"
import {
  isSignedOutReason,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
} from "@miragon/pulse-widget-shell/widgets"
import { PAGES } from "../pages.js"
import { isSegment, paramsOn, withQuery } from "./paths.js"
import { SEARCH_VIEW, searchedIn, searchUrlOf } from "./search-address.js"
import {
  EVERY_PROCESS,
  filterOf,
  filterQueryOf,
  processQueryOf,
  processStateOf,
  RUNNING_LIST,
  tabOf,
  tabQueryOf,
  type InstanceTab,
} from "./screen-queries.js"

export { INSTANCE_TABS, type InstanceTab } from "./screen-queries.js"

/** The engine module's view, the cockpit: every page of the app opens it at a start of its own. */
export const COCKPIT_VIEW = "engine_open_cockpit"

/**
 * A place of the cockpit: where it is, in its view tool's argument shape (`ViewPlace.args`):
 * `{ view, engine, <ids> }` for a view of one engine, `{ view: "board", board }`, the landing's and
 * the cross-engine overview's `{ view }`, an engine the cockpit names without a section
 * `{ engine }` alone.
 */
export type Place = Readonly<Record<string, unknown>>

/** The landing's place and start: the engines and the server's boards. */
const LANDING: Place = { view: "landing" }

/**
 * The cockpit's place of the cross-engine overview (its `view: "fleet"`), which no argument of the
 * tool names: its page starts the landing, then the cockpit opens it.
 */
const FLEET = "fleet"

/**
 * The cockpit's arguments that take no text: a query's `true` or `false` is their value. The tool's
 * input schema decides which (test/cockpit-flags.test.ts holds this list to it).
 */
const COCKPIT_FLAGS: ReadonlySet<string> = new Set(["failedOnly"])

/**
 * What a page's document title names before its view shows its heading, which then names it: the
 * product, or a board by its id (its title comes with the view).
 */
export type PageTitle =
  { readonly kind: "product" } | { readonly kind: "board"; readonly board: string }

/**
 * Where the page starts its view: the view tool and its arguments, and `place`, where the address
 * puts the view beyond the arguments (the cross-engine overview, an engine's own address: both
 * start the landing, then the cockpit goes there), absent where the arguments name it all.
 */
export interface PageStart {
  readonly view: string
  readonly args: Place
  readonly place?: Place
}

/**
 * A screen of the page's own (D10), which it shows at a place of the cockpit instead of the
 * cockpit's view there. The page claims that place (`ViewLocation.claims`): the cockpit, embedded
 * elsewhere, never shows it on the page. Its state beyond the place rides in the address's query,
 * the defaults left out.
 *
 * - `engine`: an engine's processes at the engine's own address, the place of the cockpit's
 *   overview; its list's scope and search (`filter`: `scope=incident` and `q`).
 * - `instance`: an instance at its own address, the place of the cockpit's instance view and its
 *   history; its tab (`tab`, none where the screen picks it by the instance's state) and, at the
 *   address of an incident under its instance, the root incident in focus (`incident`).
 * - `incident`: an incident the page knows by its id alone (the cockpit's drill to one, an old
 *   address of one), which the page leads on to the instance that holds its root.
 * - `process`: a process in one version at the process's own address, the place of the cockpit's
 *   process view and of its list of a process's instances; the version by its number (`version`,
 *   none for the latest) and its instance list's filter (`filter`: `scope`, `element`, `key`,
 *   `var`).
 * - `search`: the search for an instance across engines at the search's own address, a place of
 *   the page's alone, which no view of the cockpit has; what it searches (`text`, `q` in the
 *   address, trimmed, none for an empty search).
 */
export type PageScreen =
  | { readonly kind: "engine"; readonly engine: string; readonly filter: ProcessFilterData }
  | {
      readonly kind: "process"
      readonly engine: string
      readonly process: string
      readonly version?: number
      readonly filter: InstanceListFilterData
    }
  | {
      readonly kind: "instance"
      readonly engine: string
      readonly instance: string
      readonly tab?: InstanceTab
      readonly incident?: string
    }
  | { readonly kind: "incident"; readonly engine: string; readonly incident: string }
  | { readonly kind: "search"; readonly text: string }

/**
 * Where a page's location leads: a view, or the signed-out page. A view's route names its place,
 * its canonical address (`url`: the one the address bar shows, where an old address or another
 * spelling of it is replaced), the start the page opens it at and its document title; where the
 * page shows the place with a screen of its own, that screen (`screen`), the start then the
 * cockpit's for an engine the screen does not serve (a refused profile, one the server does not
 * configure, an incident by its id alone on a Camunda 8 engine).
 */
export type PageRoute =
  | {
      readonly kind: "view"
      readonly place: Place
      readonly url: string
      readonly start: PageStart
      readonly screen?: PageScreen
      readonly title: PageTitle
    }
  | { readonly kind: "signed-out"; readonly reason: SignedOutReason }

export type ViewRoute = Extract<PageRoute, { kind: "view" }>

/** The parts of the page's URL a route reads. */
export interface PageLocation {
  readonly pathname: string
  readonly search: string
}

/**
 * How an id of a place rides in an address's query: its name there and its value both ways. `write`
 * gives the value's text, null where the address leaves it out (the default), undefined for a value
 * the address does not carry; `read` gives the value of a text, undefined for one it does not read.
 */
interface QueryParam {
  readonly id: string
  readonly name: string
  readonly write: (value: unknown) => string | null | undefined
  readonly read: (text: string) => unknown
}

/** An id that is a text in the address too. */
const text = (id: string, name: string): QueryParam => ({
  id,
  name,
  write: (value) => (typeof value === "string" ? value : undefined),
  read: (value) => value,
})

/** A flag: `true` in the address where it is set, left out where it is not (its default). */
const flag = (id: string, name: string): QueryParam => ({
  id,
  name,
  write: (value) => (value === true ? "true" : value === false ? null : undefined),
  read: (value) => (value === "true" ? true : undefined),
})

/** One value of an id, which the address spells as a word of its own. */
const word = (id: string, name: string, value: string, spelled: string): QueryParam => ({
  id,
  name,
  write: (given) => (given === value ? spelled : undefined),
  read: (given) => (given === spelled ? value : undefined),
})

/**
 * A view's canonical address: the page (a pattern of `PAGES`) it lies on, the id of the place each
 * of its `:params` holds (null for one the address keeps beyond the place), the ids its query
 * carries, and a parameter that tells it from another view on the same page.
 */
interface Address {
  readonly page: string
  readonly view: string
  readonly params: Readonly<Record<string, string | null>>
  readonly query: readonly QueryParam[]
  readonly mark?: readonly [string, string]
}

const ENGINE = { engine: "engine" } as const
const INSTANCE = { ...ENGINE, instance: "processInstanceId" } as const

/** An incident's address under the instance that holds it, which the cockpit's place names alone. */
const INCIDENT_ADDRESS: Address = {
  page: PAGES.incident,
  view: "incident-detail",
  params: { ...ENGINE, instance: null, incident: "incidentId" },
  query: [],
}

/**
 * Every view's address, as the plan's address scheme names it: the query carries the view's state
 * alone, its defaults left out. An incident lies under the instance that raised it; the cockpit's
 * place of an incident names the incident alone, so it keeps the cockpit's query until the page
 * finds the instance (`urlOf`), and its address opens the incident by its id.
 */
const ADDRESSES: readonly Address[] = [
  { page: PAGES.app, view: "landing", params: {}, query: [] },
  { page: PAGES.fleet, view: FLEET, params: {}, query: [] },
  { page: PAGES.board, view: "board", params: { id: "board" }, query: [] },
  { page: PAGES.engine, view: "overview", params: ENGINE, query: [] },
  {
    page: PAGES.process,
    view: "process-detail",
    params: { ...ENGINE, process: "processDefinitionKey" },
    query: [word("focus", "scope", "incidents", "incident")],
  },
  {
    page: PAGES.instances,
    view: "process-instances",
    params: ENGINE,
    query: [text("processDefinitionKey", "process")],
  },
  { page: PAGES.instance, view: "history", params: INSTANCE, query: [], mark: ["tab", "history"] },
  { page: PAGES.instance, view: "instance-detail", params: INSTANCE, query: [] },
  INCIDENT_ADDRESS,
  { page: PAGES.incidents, view: "incidents", params: ENGINE, query: [] },
  {
    page: PAGES.cause,
    view: "cluster-detail",
    params: ENGINE,
    query: [
      text("activityId", "activity"),
      text("incidentType", "type"),
      text("messageSignature", "signature"),
    ],
  },
  {
    page: PAGES.jobs,
    view: "jobs",
    params: ENGINE,
    query: [text("processDefinitionKey", "process"), flag("failedOnly", "failed")],
  },
]

/** The address's path with each `:param`'s value, or undefined where one can be no segment. */
function pathOf(address: Address, valueOf: (param: string) => unknown): string | undefined {
  const parts = address.page.split("/").map((part) => {
    if (!part.startsWith(":")) return part
    const value = valueOf(part.slice(1))
    return isSegment(value) ? encodeURIComponent(value) : undefined
  })
  return parts.includes(undefined) ? undefined : parts.join("/")
}

/** The address's query for `place`, or undefined where it holds a value the address does not carry. */
function queryOf(address: Address, place: Place): string | undefined {
  const query = new URLSearchParams(address.mark === undefined ? [] : [[...address.mark]])
  for (const param of address.query) {
    if (!Object.hasOwn(place, param.id)) continue
    const value = param.write(place[param.id])
    if (value === undefined) return undefined
    if (value !== null) query.set(param.name, value)
  }
  return query.toString()
}

/** The place's address on `address`, or undefined where the address cannot name the whole place. */
function written(address: Address, place: Place): string | undefined {
  if (place.view !== address.view) return undefined
  const ids = new Set<unknown>(["view", ...Object.values(address.params)])
  for (const param of address.query) ids.add(param.id)
  if (Object.keys(place).some((key) => !ids.has(key))) return undefined
  const path = pathOf(address, (param) => {
    const id = address.params[param]
    return typeof id === "string" ? place[id] : undefined
  })
  const query = queryOf(address, place)
  if (path === undefined || query === undefined) return undefined
  return query === "" ? path : `${path}?${query}`
}

/** A parameter's text: a place holds ids, names and the cockpit's flags, nothing else. */
function paramOf(value: unknown): string | undefined {
  if (typeof value === "string") return value
  return typeof value === "boolean" || typeof value === "number" ? `${value}` : undefined
}

/** The cockpit's query of a place, one parameter per argument, where no address names it. */
function cockpitUrlOf(place: Place): string {
  const query = new URLSearchParams(
    Object.entries(place).flatMap(([key, value]) => {
      const param = paramOf(value)
      return param === undefined ? [] : [[key, param]]
    }),
  ).toString()
  return query === "" ? PAGES.cockpit : `${PAGES.cockpit}?${query}`
}

/** The place without what it leaves unset, as the address names it. */
function canonicalOf(place: Place): Place {
  const set = Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined))
  const keys = Object.keys(set)
  if (keys.length === 0) return LANDING
  // An engine named alone (one without sections): its address is the engine's own.
  return keys.join() === "engine" ? { view: "overview", ...set } : set
}

/**
 * The address of a place of the cockpit, which `routeOf` reads back to it: the view's canonical
 * address (`ADDRESSES`), each id a segment of its path or a parameter of its query. A place no
 * address names whole keeps the cockpit's query under `/app/cockpit`, one parameter per argument:
 * an id that can be no segment (empty, `.` or `..`), an argument no address carries, and an
 * incident, which the cockpit names without its instance.
 */
export function urlOf(place: Place): string {
  const target = canonicalOf(place)
  for (const address of ADDRESSES) {
    const url = written(address, target)
    if (url !== undefined) return url
  }
  return cockpitUrlOf(place)
}

/** One text per place, whatever the order of its arguments and whether the address typed them. */
export function placeKey(place: Place): string {
  return JSON.stringify(
    Object.keys(place)
      .sort()
      .map((key) => [key, String(place[key])]),
  )
}

/** A place read from an address, and the address it names canonically. */
interface Read {
  readonly place: Place
  readonly url: string
}

/**
 * The place an address on `address` names, and its canonical address: the view's ids from its
 * path and its query (a parameter it does not read is left out, so the canonical address drops
 * it), the address as read where it keeps an id beyond the place.
 */
function readOn(address: Address, { pathname, search }: PageLocation): Read | undefined {
  const params = paramsOn(address.page, pathname)
  if (params === undefined) return undefined
  const query = new URLSearchParams(search)
  if (address.mark !== undefined && query.get(address.mark[0]) !== address.mark[1]) return undefined
  const place: Record<string, unknown> = { view: address.view }
  for (const [param, id] of Object.entries(address.params)) {
    if (id !== null) place[id] = params[param]
  }
  for (const param of address.query) {
    const given = query.get(param.name)
    const value = given === null ? undefined : param.read(given)
    if (value !== undefined) place[param.id] = value
  }
  const keeps = Object.values(address.params).includes(null)
  const kept = keeps ? pathOf(address, (param) => params[param]) : undefined
  return { place, url: kept ?? urlOf(place) }
}

const isFlag = (key: string, value: string): boolean =>
  COCKPIT_FLAGS.has(key) && (value === "true" || value === "false")

/**
 * The cockpit's arguments from the query of `/app/cockpit`, one per parameter, as
 * `engine_open_cockpit` takes them (`view`, `engine` and the ids its start view needs). The tool
 * refuses a parameter it does not know, and the page shows why: no parameter is dropped unseen.
 */
function cockpitArgs(search: string): Record<string, unknown> {
  return Object.fromEntries(
    [...new URLSearchParams(search)].map(([key, value]) => [
      key,
      isFlag(key, value) ? value === "true" : value,
    ]),
  )
}

/** The place the cockpit's query names, and its canonical address, which replaces it. */
function readCockpit(search: string): Read {
  const place = cockpitArgs(search)
  return { place, url: urlOf(place) }
}

/**
 * The place a canonical address names, else the landing: the server serves the page at the
 * patterns of `PAGES` alone.
 */
function readAddress(location: PageLocation): Read {
  for (const address of ADDRESSES) {
    const read = readOn(address, location)
    if (read !== undefined) return read
  }
  return { place: LANDING, url: PAGES.app }
}

/** The place's arguments as one text, their order aside. */
const shapeOf = (place: Place): string => Object.keys(place).sort().join()

/**
 * Where the page starts the view at `place`: the landing for the landing, and for the places the
 * landing's start leads on to (the cross-engine overview, which no argument of the tool names, and
 * an engine's own address, whose engine may have no section the cockpit serves: one whose profile
 * the server refused, which the cockpit then shows as its one state, or a Camunda 8 engine, which
 * the page shows on its own engine screen, and the tool takes no `engine` on a server of Camunda 8
 * clusters alone). The page refuses an engine there that the
 * server does not configure (`viewsAt`), as the tool does at any other address of it, and the
 * address stays. Any other place is the tool's arguments, and the tool refuses an argument it does
 * not take.
 */
function startOf(place: Place): PageStart {
  const shape = shapeOf(place)
  if (shape === "" || (shape === "view" && place.view === LANDING.view)) {
    return { view: COCKPIT_VIEW, args: LANDING }
  }
  const onLanding =
    (shape === "view" && place.view === FLEET) ||
    shape === "engine" ||
    (shape === "engine,view" && place.view === "overview")
  return onLanding
    ? { view: COCKPIT_VIEW, args: LANDING, place }
    : { view: COCKPIT_VIEW, args: place }
}

/**
 * The page's own screen at `place`, as the place names it whole: an engine's overview, which the
 * page shows as the engine's processes, its list unfiltered; a process's view or the list of a
 * process's instances, which it shows as the process screen at its latest version, its running
 * instances listed (with its incidents in focus, those with incident); an instance's view or its history,
 * which it shows as the instance screen (the history its tab); an incident by its id, which it
 * leads on to the instance that holds its root. An engine named alone (one without sections, as the
 * cockpit reports it) is no such place: the cockpit shows its one state; nor is a place with an id
 * that can be no segment, which keeps the cockpit's query.
 */
export function screenOf(place: Place): PageScreen | undefined {
  const { view, engine, processInstanceId, incidentId } = place
  if (!isSegment(engine)) return undefined
  switch (shapeOf(place)) {
    case "engine,view":
      return view === "overview" ? { kind: "engine", engine, filter: EVERY_PROCESS } : undefined
    case "engine,processDefinitionKey,view":
    case "engine,focus,processDefinitionKey,view":
      return processScreenOf(engine, place)
    case "engine,processInstanceId,view":
      if (!isSegment(processInstanceId)) return undefined
      if (view === "history") {
        return { kind: "instance", engine, instance: processInstanceId, tab: "history" }
      }
      return view === "instance-detail"
        ? { kind: "instance", engine, instance: processInstanceId }
        : undefined
    case "engine,incidentId,view":
      return view === "incident-detail" && isSegment(incidentId)
        ? { kind: "incident", engine, incident: incidentId }
        : undefined
    default:
      return undefined
  }
}

/**
 * The process screen at a process's view or the list of its instances on `engine`, where the
 * process's id can be a segment of its address: its running instances listed, with its incidents in
 * focus those with incident.
 */
function processScreenOf(engine: string, place: Place): PageScreen | undefined {
  const { view, focus, processDefinitionKey: process } = place
  if (!isSegment(process)) return undefined
  const instances = view === "process-instances" && focus === undefined
  if (view !== "process-detail" && !instances) return undefined
  if (focus === undefined) return { kind: "process", engine, process, filter: RUNNING_LIST }
  return focus === "incidents"
    ? { kind: "process", engine, process, filter: { scope: "withIncident" } }
    : undefined
}

/**
 * The page's own screen at `location`, whose place is `place`: the screen the place names, with its
 * state from the address's query (the engine screen's filter, the instance screen's tab), and at the
 * address of an incident under its instance the instance screen with that incident in focus.
 */
function screenAt(location: PageLocation, place: Place): PageScreen | undefined {
  const found = screenOf(place)
  if (found === undefined) return undefined
  switch (found.kind) {
    case "engine":
      return { ...found, filter: filterOf(location.search) }
    case "process":
      // The process's own address carries the screen's state; an old list of its instances none.
      return paramsOn(PAGES.process, location.pathname) === undefined
        ? found
        : { ...found, ...processStateOf(location.search, found.filter.scope) }
    case "instance": {
      const tab = found.tab ?? tabOf(location.search)
      return tab === undefined ? found : { ...found, tab }
    }
    case "incident": {
      const instance = paramsOn(PAGES.incident, location.pathname)?.instance
      if (!isSegment(instance)) return found
      const tab = tabOf(location.search)
      const focused: PageScreen = {
        kind: "instance",
        engine: found.engine,
        instance,
        incident: found.incident,
      }
      return tab === undefined ? focused : { ...focused, tab }
    }
  }
}

/** The address of an incident under its instance, or undefined where an id can be no segment. */
function incidentPathOf(engine: string, instance: string, incident: string): string | undefined {
  const params: Readonly<Record<string, string>> = { engine, instance, incident }
  return pathOf(INCIDENT_ADDRESS, (param) => params[param])
}

/**
 * The address of the page's own screen, which `viewRouteOf` reads back to it: the engine's own
 * address with its list's filter in the query, the defaults left out; a process's own address with
 * its version and its list's filter in the query, the defaults left out; an instance's own address,
 * or an incident's under it, with its tab in the query where the reader picked one; an incident
 * by its id alone in the cockpit's query.
 */
export function screenUrlOf(screen: PageScreen): string {
  switch (screen.kind) {
    case "engine":
      return withQuery(
        urlOf({ view: "overview", engine: screen.engine }),
        filterQueryOf(screen.filter),
      )
    case "process": {
      const { engine, process } = screen
      const path = urlOf({ view: "process-detail", engine, processDefinitionKey: process })
      // An id no segment takes keeps the cockpit's process view, which takes no screen state.
      return path.startsWith(PAGES.cockpit)
        ? path
        : withQuery(path, processQueryOf(screen.version, screen.filter))
    }
    case "instance": {
      const { engine, instance, tab, incident } = screen
      const own = urlOf({ view: "instance-detail", engine, processInstanceId: instance })
      const path =
        incident === undefined ? own : (incidentPathOf(engine, instance, incident) ?? own)
      return withQuery(path, tabQueryOf(tab))
    }
    case "incident":
      return urlOf({ view: "incident-detail", engine: screen.engine, incidentId: screen.incident })
    case "search":
      return searchUrlOf(screen.text)
  }
}

/**
 * The search's route: its place (`view: "search"` with what it searches, the navigation's field
 * keeps it), its canonical address (the text trimmed, any other parameter dropped) and its screen;
 * the cockpit's landing its start, which the page never shows there.
 */
function searchRouteOf({ search }: PageLocation): ViewRoute {
  const text = searchedIn(search)
  return {
    kind: "view",
    place: { view: SEARCH_VIEW, q: text },
    url: searchUrlOf(text),
    start: { view: COCKPIT_VIEW, args: LANDING },
    screen: { kind: "search", text },
    title: { kind: "product" },
  }
}

/** A board's page names the board by its id until the view titles it; any other page Pulse. */
function titleOf(place: Place): PageTitle {
  const { view, board } = place
  return view === "board" && typeof board === "string"
    ? { kind: "board", board }
    : { kind: "product" }
}

/**
 * The view a location of a page with a view opens. The search's address opens the page's search
 * (`searchRouteOf`). A canonical address names its view (`ADDRESSES`); the cockpit's query under `/app/cockpit`, the address of every view before this
 * scheme, names it as the tool's arguments, and the route's `url` is its canonical address, which
 * replaces it. Where the page shows the place with a screen of its own (`screenOf`), the route
 * names it beside the cockpit's start, with the screen's state from the query, which its canonical
 * address keeps (`screenUrlOf`).
 */
export function viewRouteOf(location: PageLocation): ViewRoute {
  if (location.pathname === PAGES.search) return searchRouteOf(location)
  const { place, url } =
    location.pathname === PAGES.cockpit ? readCockpit(location.search) : readAddress(location)
  // An engine named alone is its address's place too: the page's screen, or the cockpit's one state.
  const screen = screenAt(location, canonicalOf(place))
  return {
    kind: "view",
    place,
    url: screen === undefined ? url : screenUrlOf(screen),
    start: startOf(place),
    ...(screen === undefined ? {} : { screen }),
    title: titleOf(place),
  }
}

/**
 * The route a location opens: the signed-out page with its reason, the one of a sign-out where the
 * query names none (the identity provider's way back after a sign-out names none), else a view
 * (`viewRouteOf`).
 */
export function routeOf(location: PageLocation): PageRoute {
  if (location.pathname !== WEB_PATHS.signedOut) return viewRouteOf(location)
  const reason = new URLSearchParams(location.search).get(WEB_QUERY.reason)
  return { kind: "signed-out", reason: isSignedOutReason(reason) ? reason : "signed_out" }
}

/** The sign-in that comes back to `returnTo` (a page and its query), else to `/app`. */
export function signInUrl(returnTo?: string): string {
  if (returnTo === undefined || returnTo === PAGES.app) return WEB_PATHS.login
  return `${WEB_PATHS.login}?${WEB_QUERY.returnTo}=${encodeURIComponent(returnTo)}`
}
