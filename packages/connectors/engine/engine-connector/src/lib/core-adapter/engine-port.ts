/**
 * The engine port of @miragon/pulse-c7-core over the engine client: each operation the
 * composites send (c7-core's INSPECT_OPERATIONS and STATUS_OPERATIONS) goes out as its route of
 * `CORE_ROUTES` (`routedTransport`), through the client and so through the engine's one
 * transport, at most 8 requests in flight per call. No table of operations to SDK functions: the
 * route says the method, the path, the media type to accept and whether it only reads. Built per
 * tool call on the client `withEngine` resolved (invariant 2): never cached.
 */

import type { Client } from "@miragon/pulse-c7-client"
import {
  CORE_ROUTES,
  createEnginePort,
  type EngineFailure,
  isMissing,
  type EnginePort,
  type OperationInput,
  type Route,
  routedTransport,
  type RoutedWire,
  Slots,
} from "@miragon/pulse-c7-core"
import { EngineRequestError } from "../engine/engine-error.js"

/** The names of a path template's placeholders, in path order: `{id}` gives `id`. */
function placeholdersOf(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "")
}

/** Whether a route answers text only (a stacktrace, error details), which the SDK reads as text. */
function answersText(route: Route): boolean {
  return route.accepts.length > 0 && route.accepts.every((type) => type === "text/plain")
}

/**
 * The SDK call of `route`, as the generated function of its operation sends it: the template, its
 * values by name, the query, what to accept; a text route read as text.
 */
function callOf(route: Route, input: OperationInput) {
  const names = placeholdersOf(route.path)
  return {
    url: route.path,
    path: Object.fromEntries(names.map((name, at) => [name, input.pathArgs[at]])),
    query: input.query,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(route.accepts.length > 0 ? { headers: { Accept: route.accepts.join(", ") } } : {}),
    ...(answersText(route) ? { parseAs: "text" as const } : {}),
  }
}

/** The client's methods by a route's method. */
const SEND = {
  GET: "get",
  POST: "post",
  PUT: "put",
  DELETE: "delete",
  OPTIONS: "options",
} as const satisfies Record<Route["method"], keyof Client>

/**
 * How c7-core's routes go out through `client`: the answer is what the SDK read (JSON parsed,
 * integers beyond 2^53 as exact-digit strings; a text route's text), a failure the client's
 * `EngineRequestError`.
 */
function clientWire(client: Client): RoutedWire<unknown> {
  return {
    send: (route, input) => client[SEND[route.method]](callOf(route, input)),
    json: (answer) => answer,
    text: (answer) => (typeof answer === "string" ? answer : undefined),
    failure: engineFailure,
  }
}

/**
 * The engine answer of an `http` failure; unreachable, connection, timeout, cancelled and every
 * other error give undefined, so c7-core rethrows them unchanged.
 */
export function engineFailure(error: unknown): EngineFailure | undefined {
  if (!(error instanceof EngineRequestError) || error.kind !== "http") return undefined
  if (error.httpStatus === undefined) return undefined
  return {
    status: error.httpStatus,
    ...(error.type === undefined ? {} : { engineType: error.type }),
    engineMessage: error.engineMessage,
  }
}

/**
 * c7-core's missing-resource rule (`isMissing`) over a c7-client error: an engine 404
 * that names a missing resource. A wrong REST root (a 404 `NotFoundException`, or a 404 without
 * an engine answer) is no missing resource; it fails loud wherever a caller reads it.
 */
export function isMissingResource(error: unknown): boolean {
  return isMissing(engineFailure(error))
}

/**
 * The value of `read`, or `null` when it names a missing resource ({@link isMissingResource});
 * every other failure, a wrong REST root included, rejects.
 */
export async function noneIfMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (error) {
    if (isMissingResource(error)) return null
    throw error
  }
}

/** c7-core's port over `client`, the operations c7-core sends only, with one set of 8 slots for this call. */
export function enginePortFor(client: Client): EnginePort {
  const slots = new Slots()
  const routed = routedTransport(CORE_ROUTES, clientWire(client))
  return createEnginePort({
    ...routed,
    send: (operationId, input) => slots.run(() => routed.send(operationId, input)),
  })
}
