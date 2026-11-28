import { withCallerSignal, type Client } from "@miragon/pulse-c7-client"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import type {
  C7EngineEntry,
  C7EngineProvider,
  ContractDialect,
  ContractEngineProvider,
  EngineEntry,
} from "../../engine-provider.js"
import { camunda8Reads } from "../shared/camunda8-scope.js"
import { providerForEntry } from "../../providers/index.js"
import type { EngineDialect } from "../../view-models.js"
import { PROFILE_REFUSED, profileRefusalText } from "../shared/profile-refusal.js"
import type { EngineLink } from "./cockpit-url.js"
import { isReadingPost } from "./engine-connection.js"

/** A configured engine of the Camunda 7 REST API: its address and provider, its client and its write gate. */
interface C7Backend extends EngineLink {
  dialect: "c7"
  provider: C7EngineProvider
  client: Client
  /** Its profile's `readOnly`: no tool writes to it. */
  readOnly: boolean
}

/** An engine of another dialect's runtime for one call, its reads bound to the caller's signal. */
export type ContractRuntime = (signal?: AbortSignal) => ProcessRuntime

/**
 * A configured engine of another dialect: the server reads it through the engine contract alone
 * (`resolveRuntimeEngine`: boards and diagrams), and every Camunda 7 path refuses it
 * (`resolveEngine`, ENGINE_DIALECT_NOT_SERVED).
 */
interface ContractBackend {
  dialect: ContractDialect
  provider: ContractEngineProvider
  /** The profile's `cockpitUrl` as written. */
  cockpitUrl?: string
  /** No tool writes to it: the server only reads another dialect. */
  readOnly: true
  /** The ids of the configured boards that name it, in the order of the board files. */
  boards: readonly string[]
  runtime: ContractRuntime
}

/** A configured engine, by the dialect it speaks. */
export type EngineBackend = C7Backend | ContractBackend

/** The engine a call runs on: its client (bound to the caller's signal), id, URLs and provider. */
export interface ResolvedEngine extends EngineLink {
  client: Client
  engineId: string
}

/** An engine of another dialect a dialect-neutral read resolved: its runtime per call. */
export interface ResolvedContractEngine {
  dialect: ContractDialect
  engineId: string
  provider: ContractEngineProvider
  cockpitUrl?: string
  /** The configured engine: what the module keeps per engine (the XML cache) keys on it. */
  backend: ContractBackend
  /** The caller's signal, which the runtime's reads abort with. */
  signal?: AbortSignal
}

/** The engine a dialect-neutral read runs on: a Camunda 7 engine with its client, or another dialect's. */
export type RuntimeEngine = ResolvedEngine | ResolvedContractEngine

/** A profile the server refused, as a call to it learns: the id and why, never a value. */
export interface RefusedProfile {
  id: string
  /** Its environment, when its profile states one the parser took. */
  environment?: string
  /** The dialect its profile names, when the parser read one: the tools of it name the profile. */
  dialect?: EngineDialect
  reason: string
}

/** No in-memory selection state: it would break behind more than one replica; the operator sets `defaultEngineId` instead. */
export interface EngineRegistry {
  /** Engine id to its backend by dialect (client or runtime, URLs and provider), in configuration order. */
  backends: ReadonlyMap<string, EngineBackend>
  /** The usable engines, in configuration order. */
  engines: EngineEntry[]
  /** The refused profiles by engine id: a call to one fails with ENGINE_PROFILE_REFUSED. */
  refused: ReadonlyMap<string, RefusedProfile>
  /** Every configured engine id, refused ones included, in configuration order (the enum). */
  engineIds: readonly string[]
  /** Every profile, refused and nameless ones included: only one alone is the default. */
  profileCount: number
  /** `ENGINE_DEFAULT` or `defaultProfile`; the config already refused an id no profile carries. */
  defaultEngineId?: string
}

export interface EngineRegistryOptions {
  defaultEngineId?: string
  refused?: readonly RefusedProfile[]
  /** Default: the engines' ids, then the refused ones. */
  engineIds?: readonly string[]
  /** Default: the engines and the refused profiles. */
  profileCount?: number
  /** The runtime of each engine of another dialect; without it, such an engine fails the boot. */
  contractRuntime?: (engine: EngineEntry) => ContractRuntime
  /** The ids of the configured boards that name an engine; default: none. */
  boardsNaming?: (engineId: string) => readonly string[]
}

/** The backend of `engine`: a client for Camunda 7, the contract's runtime for another dialect. */
function backendOf(
  engine: EngineEntry,
  clientFor: (engine: C7EngineEntry) => Client,
  opts: EngineRegistryOptions,
): EngineBackend {
  // Throws on an unknown flavor: fail the boot rather than emit wrong cockpit links.
  const provider = providerForEntry(engine)
  if (provider.dialect === "c7") {
    const { baseUrl, cockpitUrl, readOnly } = engine
    // Its provider speaks Camunda 7, so its flavor is one of that dialect's (or none).
    const client = clientFor(engine as C7EngineEntry)
    return { dialect: "c7", provider, client, baseUrl, cockpitUrl, readOnly: readOnly === true }
  }
  const runtime = opts.contractRuntime?.(engine)
  if (runtime === undefined) {
    throw new Error(
      `createEngineRegistry: engine "${engine.id}" speaks ${provider.dialect}, and no runtime for it was handed in`,
    )
  }
  return {
    dialect: provider.dialect,
    provider,
    ...(engine.cockpitUrl === undefined ? {} : { cockpitUrl: engine.cockpitUrl }),
    readOnly: true,
    boards: opts.boardsNaming?.(engine.id) ?? [],
    runtime,
  }
}

export function createEngineRegistry(
  engines: EngineEntry[],
  clientFor: (engine: C7EngineEntry) => Client,
  opts: EngineRegistryOptions = {},
): EngineRegistry {
  // Programmer errors fail the boot, not the first call.
  if (engines.length === 0) throw new Error("createEngineRegistry needs at least one engine")
  const backends = new Map<string, EngineBackend>()
  for (const e of engines) {
    if (backends.has(e.id)) throw new Error(`createEngineRegistry: duplicate engine id "${e.id}"`)
    backends.set(e.id, backendOf(e, clientFor, opts))
  }
  const refused = new Map((opts.refused ?? []).map((profile) => [profile.id, profile]))
  return {
    backends,
    engines,
    refused,
    engineIds: opts.engineIds ?? [...backends.keys(), ...refused.keys()],
    profileCount: opts.profileCount ?? backends.size + refused.size,
    defaultEngineId: opts.defaultEngineId,
  }
}

/** Lists the engine ids in the message: only code + message reach the model, so this saves a `engine_list_engines` round trip. */
export class EngineNotSelectedError extends Error {
  readonly code = "ENGINE_NOT_SELECTED" as const
  readonly availableEngines: EngineEntry[]
  constructor(availableEngines: EngineEntry[]) {
    const ids = availableEngines.map((e) => e.id).join(", ")
    super(`No engine specified and no default engine configured. Pass \`engine\`, one of: ${ids}.`)
    this.name = "EngineNotSelectedError"
    this.availableEngines = availableEngines
  }
}

export class UnknownEngineError extends Error {
  readonly code = "UNKNOWN_ENGINE" as const
  readonly requestedEngine: string
  readonly availableEngines: EngineEntry[]
  constructor(requestedEngine: string, availableEngines: EngineEntry[]) {
    super(
      `Unknown engine id "${requestedEngine}". Available: ${availableEngines.map((e) => e.id).join(", ")}.`,
    )
    this.name = "UnknownEngineError"
    this.requestedEngine = requestedEngine
    this.availableEngines = availableEngines
  }
}

/**
 * A call to an engine whose profile the server refused: the reason names keys only, never a
 * value or a variable, so the model can tell the user what whoever runs the server has to fix
 * (the instructions and the widgets' model contexts call the person at the widget the operator).
 */
export class EngineProfileRefusedError extends Error {
  readonly code: typeof PROFILE_REFUSED = PROFILE_REFUSED
  readonly engineId: string
  constructor({ id, reason }: RefusedProfile) {
    super(profileRefusalText(id, reason))
    this.name = "EngineProfileRefusedError"
    this.engineId = id
  }
}

/** What a tool, feed or route of each dialect reads, as a refusal names it. */
const DIALECT_APIS: Readonly<Record<EngineDialect, string>> = {
  c7: "the Camunda 7 REST API (Camunda 7, CIB seven, Operaton)",
  c8: "Camunda 8's Orchestration Cluster REST API",
}

/**
 * What reads an engine of another dialect (Camunda 8) instead, by the marks (`camunda8Reads`), and
 * the boards that name it, or that none does yet.
 */
function readsInstead(engineId: string, product: string, boards: readonly string[]): string {
  const reads = `On this server ${camunda8Reads(`a ${product} engine`, "it")}`
  return boards.length > 0
    ? `${reads}; engine_list_engines lists the boards that name it.`
    : `${reads}; no board names "${engineId}" yet, the server's operator adds one.`
}

/**
 * A call of a tool, a feed, an engine view of the cockpit or a write on an engine whose dialect it
 * does not serve (its mark, `dialects`): refused before anything is sent, never rerouted. The
 * server reads an engine of another dialect through the engine contract alone
 * (`resolveRuntimeEngine`), so the text names what does: its tools and views, and its boards.
 */
export class EngineDialectNotServedError extends Error {
  readonly code = "ENGINE_DIALECT_NOT_SERVED" as const
  readonly engineId: string
  constructor(engineId: string, backend: EngineBackend, dialects: readonly EngineDialect[]) {
    const product = backend.provider.branding.displayName
    const reads = dialects.map((dialect) => DIALECT_APIS[dialect]).join(" or ")
    const where =
      backend.dialect === "c7" ? "" : ` ${readsInstead(engineId, product, backend.boards)}`
    super(
      `Engine "${engineId}" is a ${product} engine, and this tool or view reads ${reads}, so nothing was sent.${where}`,
    )
    this.name = "EngineDialectNotServedError"
    this.engineId = engineId
  }
}

/** A write to an engine whose profile sets `readOnly`: refused before anything is sent. */
export class EngineReadOnlyError extends Error {
  readonly code = "ENGINE_READ_ONLY" as const
  readonly engineId: string
  constructor(engineId: string) {
    super(
      `Engine "${engineId}" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.`,
    )
    this.name = "EngineReadOnlyError"
    this.engineId = engineId
  }
}

/** The SDK's handler `ctx` (`ServerContext`) satisfies this structurally. */
export interface EngineCallContext {
  mcpReq?: { signal?: AbortSignal }
}

/** An empty `""` override counts as no engine named; it still skips the default. */
function pickEngineId(override: string | undefined, registry: EngineRegistry): string {
  const id = override ?? registry.defaultEngineId
  if (id) return id
  // Counted with the refused profiles: a broken neighbour never reroutes to the other engine.
  const [only] = registry.engineIds
  if (only !== undefined && registry.profileCount === 1) return only
  throw new EngineNotSelectedError(registry.engines)
}

/**
 * The engine a call goes to, of any dialect, never a refused one: precedence `override` > the
 * default > the only one.
 */
export function backendFor(
  override: string | undefined,
  registry: EngineRegistry,
): { engineId: string; backend: EngineBackend } {
  const engineId = pickEngineId(override, registry)
  const refused = registry.refused.get(engineId)
  if (refused) throw new EngineProfileRefusedError(refused)
  const backend = registry.backends.get(engineId)
  if (!backend) throw new UnknownEngineError(engineId, registry.engines)
  return { engineId, backend }
}

/** The Camunda 7 engine a call goes to: another dialect's is refused, after a refused profile. */
function c7BackendFor(
  override: string | undefined,
  registry: EngineRegistry,
): { engineId: string; backend: C7Backend } {
  const { engineId, backend } = backendFor(override, registry)
  if (backend.dialect !== "c7") throw new EngineDialectNotServedError(engineId, backend, ["c7"])
  return { engineId, backend }
}

/**
 * The Camunda 7 engine `engineId` as a call resolves it: its client bound to the caller's signal,
 * its reads (a POST that only reads, by the route table, included) aborting with it.
 */
function resolvedC7(
  engineId: string,
  backend: C7Backend,
  call?: EngineCallContext,
): ResolvedEngine {
  const { baseUrl, cockpitUrl, provider } = backend
  return {
    baseUrl,
    cockpitUrl,
    provider,
    client: withCallerSignal(backend.client, call?.mcpReq?.signal, isReadingPost),
    engineId,
  }
}

/**
 * Precedence: `override` > `ENGINE_DEFAULT` (or `defaultProfile`) > the only engine. Serves the
 * Camunda 7 REST API alone: an engine of another dialect fails with ENGINE_DIALECT_NOT_SERVED.
 * Pass the handler's `ctx` so reads abort with the MCP request (writes run to completion).
 */
export function resolveEngine(
  override: string | undefined,
  registry: EngineRegistry,
  call?: EngineCallContext,
): ResolvedEngine {
  const { engineId, backend } = c7BackendFor(override, registry)
  return resolvedC7(engineId, backend, call)
}

/**
 * The engine a dialect-neutral read runs on (a board's engines, a diagram's XML), by the
 * precedence of `resolveEngine`, a refused profile refused alike: a Camunda 7 engine as
 * `resolveEngine` gives it, an engine of another dialect with its runtime, bound to the caller's
 * signal per read.
 */
export function resolveRuntimeEngine(
  override: string | undefined,
  registry: EngineRegistry,
  call?: EngineCallContext,
): RuntimeEngine {
  const { engineId, backend } = backendFor(override, registry)
  if (backend.dialect === "c7") return resolvedC7(engineId, backend, call)
  const { dialect, provider, cockpitUrl } = backend
  const signal = call?.mcpReq?.signal
  return {
    dialect,
    engineId,
    provider,
    ...(cockpitUrl === undefined ? {} : { cockpitUrl }),
    backend,
    ...(signal === undefined ? {} : { signal }),
  }
}
