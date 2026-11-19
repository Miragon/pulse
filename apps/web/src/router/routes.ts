import {
  isSignedOutReason,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
} from "@miragon/pulse-widget-shell/widgets"
import { PAGES } from "../pages.js"

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
 * Where a page's location leads: a view, or the signed-out page. A view's route names its place,
 * its canonical address (`url`: the one the address bar shows, where an old address or another
 * spelling of it is replaced), the start the page opens it at and its document title.
 */
export type PageRoute =
  | {
      readonly kind: "view"
      readonly place: Place
      readonly url: string
      readonly start: PageStart
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
  {
    page: PAGES.incident,
    view: "incident-detail",
    params: { ...ENGINE, instance: null, incident: "incidentId" },
    query: [],
  },
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

/**
 * Whether `value` can be a segment of a path: a text that is neither empty nor a dot segment, in
 * any spelling (the listener refuses those, `isNormalTarget`, and a browser resolves them).
 */
const isSegment = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && value !== "." && value !== ".."

/** A segment of the path as its text: the browser escapes it, a broken escape stays as sent. */
function segmentText(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

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

/** The text of each `:param` of `page` in `pathname`, or undefined where the path is not on it. */
function paramsOn(page: string, pathname: string): Record<string, string> | undefined {
  const want = page.split("/")
  const got = pathname.split("/")
  if (want.length !== got.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, part] of want.entries()) {
    const segment = got[index]
    if (!part.startsWith(":")) {
      if (part !== segment) return undefined
    } else if (segment === "") {
      return undefined
    } else {
      params[part.slice(1)] = segmentText(segment)
    }
  }
  return params
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
 * an engine's own address, whose engine may have no section: one the server shows on boards only
 * or whose profile it refused, which the cockpit then shows as its one state, and the tool takes
 * no `engine` on a server of Camunda 8 clusters alone). The page refuses an engine there that the
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

/** A board's page names the board by its id until the view titles it; any other page Pulse. */
function titleOf(place: Place): PageTitle {
  const { view, board } = place
  return view === "board" && typeof board === "string"
    ? { kind: "board", board }
    : { kind: "product" }
}

/**
 * The view a location of a page with a view opens. A canonical address names its view
 * (`ADDRESSES`); the cockpit's query under `/app/cockpit`, the address of every view before this
 * scheme, names it as the tool's arguments, and the route's `url` is its canonical address, which
 * replaces it.
 */
export function viewRouteOf(location: PageLocation): ViewRoute {
  const { place, url } =
    location.pathname === PAGES.cockpit ? readCockpit(location.search) : readAddress(location)
  return { kind: "view", place, url, start: startOf(place), title: titleOf(place) }
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
