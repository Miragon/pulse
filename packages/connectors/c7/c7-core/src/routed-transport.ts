/**
 * An `EngineTransport` over a surface's own way of sending a route: the operation ids c7-core
 * sends become routes of a table (`CORE_ROUTES`, or the whole one), so a surface maps no operation
 * by hand and keeps no table of its own.
 */

import type { EngineFailure, EngineTransport, OperationInput } from "./port.js"
import { isPlaceholder, type Route, type Routes } from "./route.js"

/**
 * How a surface sends a route and reads its answers. Structural: a surface's HTTP client meets it
 * with a line of glue per method (the path template filled with `input.pathArgs`, in path order).
 */
export interface RoutedWire<A> {
  /** Sends the route with the input and resolves to its answer; rejects on any failure. */
  send(route: Route, input: OperationInput): Promise<A>
  /** The JSON value of an answer; undefined when it carries none. */
  json(answer: A): unknown
  /** The text of an answer; undefined when it carries none. */
  text(answer: A): string | undefined
  /**
   * The engine answer an error of `send` carries (`failureOf` its status and the problem its body
   * states); undefined for anything else.
   */
  failure(error: unknown): EngineFailure | undefined
}

/** How many placeholders a path template has. */
function placeholdersOf(path: string): number {
  return path.split("/").filter(isPlaceholder).length
}

/**
 * The transport that sends each operation c7-core asks for as its route of `routes` over `wire`.
 * An operation the table lacks, or one with more or fewer path values than its template has
 * placeholders, is refused before anything is sent.
 */
export function routedTransport<A>(routes: Routes, wire: RoutedWire<A>): EngineTransport<A> {
  return {
    async send(operationId, input) {
      const route = Object.hasOwn(routes, operationId) ? routes[operationId] : undefined
      if (route === undefined) {
        throw new Error(`c7-core asked for ${operationId}, which the route table does not hold`)
      }
      const expected = placeholdersOf(route.path)
      if (input.pathArgs.length !== expected) {
        throw new Error(
          `${operationId} takes ${expected} path values, c7-core sent ${input.pathArgs.length}`,
        )
      }
      return wire.send(route, input)
    },
    json: (answer) => wire.json(answer),
    text: (answer) => wire.text(answer),
    failure: (error) => wire.failure(error),
  }
}
