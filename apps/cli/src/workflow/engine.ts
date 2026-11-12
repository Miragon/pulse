/**
 * Engine access of the workflow commands: c7-core's port over its `routedTransport`, whose route
 * table is the catalog (each operation's method, path template, effect, engine scope and the
 * media types it answers, which the catalog takes from c7-core's generated table), so c7-core
 * refuses an operation the table lacks, or a wrong number of path values, before anything is sent.
 * Each route goes out as its catalog request through `buildRequest` + `sendRequest` exactly like
 * `ping`, so `--engine`, auth, `-H`, `--timeout`, `--verbose` traces, redirect refusal and the
 * error hints apply unchanged, and hints name the generated command of the request (`pulse task
 * complete`). The read rules (paging, missing resources, text answers) are the engine port's of
 * @miragon/pulse-c7-core.
 */

import {
  createEnginePort,
  type EngineFailure,
  type EngineTransport,
  type Route,
  routedTransport,
  type RoutedWire,
  Slots,
} from "@miragon/pulse-c7-core"
import type { Catalog, OperationSpec } from "../catalog/types.js"
import type { AuthorizedPreview, EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { PulseCliError } from "../errors.js"
import type { Client } from "../http/client.js"
import { commandRef } from "../operation/command-ref.js"
import { dryRunPreview } from "../operation/preview.js"
import {
  buildRequest,
  enginePrefix,
  expandPath,
  type OperationInput,
  type Target,
} from "../operation/request.js"
import type { OperationResult } from "../operation/result.js"
import { sendRequest } from "../operation/send.js"
import { compact } from "../util.js"

/** A route of the catalog's table, with the operation its request is built by. */
interface CatalogRoute extends Route {
  readonly operation: OperationSpec
}

function isCatalogRoute(route: Route): route is CatalogRoute {
  return "operation" in route
}

/** The media types an operation answers, in the catalog's order: what its route accepts. */
function acceptsOf(operation: OperationSpec): string[] {
  return [...new Set(operation.responses.flatMap((response) => response.contentTypes))]
}

/**
 * The catalog as a route table. A preset command (`suspend`, `activate`) shares its operation id
 * with the plain command, whose operation the route is built by.
 */
function routesOf(catalog: Catalog): Readonly<Record<string, CatalogRoute>> {
  const routes: Record<string, CatalogRoute> = {}
  const presetsLast = [...catalog.operations].sort(
    (a, b) => Number(a.preset !== undefined) - Number(b.preset !== undefined),
  )
  for (const operation of presetsLast) {
    const { operationId, method, path, effect, engineScoped } = operation
    const accepts = acceptsOf(operation)
    routes[operationId] ??= { operationId, method, path, effect, engineScoped, accepts, operation }
  }
  return routes
}

/** The engine answer of an HTTP error: every error `call` throws for a response has a status. */
function cliFailure(error: unknown): EngineFailure | undefined {
  if (!(error instanceof PulseCliError) || error.details.status === undefined) return undefined
  const { status, engineType, engineMessage } = error.details
  return { status, ...compact({ engineType, engineMessage }) }
}

/** How a route of the catalog goes out: as its catalog request, with its command for the hints. */
class CatalogWire implements RoutedWire<OperationResult> {
  constructor(
    private readonly catalog: Catalog,
    private readonly target: Target,
    private readonly client: Client,
  ) {}

  send(route: Route, input: OperationInput): Promise<OperationResult> {
    const operation = checked(route, input)
    const request = buildRequest(operation, input, this.target)
    return sendRequest(request, this.client, commandRef(operation, this.catalog))
  }

  json(result: OperationResult): unknown {
    return result.kind === "json" ? result.value : undefined
  }

  text(result: OperationResult): string | undefined {
    return result.kind === "text" ? result.text : undefined
  }

  failure(error: unknown): EngineFailure | undefined {
    return cliFailure(error)
  }
}

/** The operation of a route, its input's query names checked against it. */
function checked(route: Route, input: OperationInput): OperationSpec {
  if (!isCatalogRoute(route)) {
    throw new PulseCliError("INTERNAL", `${route.operationId} is no route of the catalog`)
  }
  const { operation } = route
  for (const [key, value] of Object.entries(input.query)) {
    const known = operation.params.some((param) => param.in === "query" && param.name === key)
    if (value !== undefined && !known) {
      throw new PulseCliError("INTERNAL", `${route.operationId} has no query parameter ${key}`)
    }
  }
  return operation
}

export function enginePort(catalog: Catalog, target: Target, client: Client): EnginePort {
  const routes = routesOf(catalog)
  const slots = new Slots()
  const routed = routedTransport(routes, new CatalogWire(catalog, target, client))
  const transport: EngineTransport<OperationResult> = {
    ...routed,
    send: (operationId, input) => slots.run(() => routed.send(operationId, input)),
  }
  /** The operation of `operationId`, for what is no request (a preview, a `Done:` line). */
  const operationOf = (operationId: string, input: OperationInput): OperationSpec => {
    const route = Object.hasOwn(routes, operationId) ? routes[operationId] : undefined
    if (route === undefined) {
      throw new PulseCliError("INTERNAL", `The catalog has no operation ${operationId}`)
    }
    return checked(route, input)
  }
  return {
    ...createEnginePort(transport),
    call: (operationId, input) => transport.send(operationId, input),
    preview: async (request: PlannedRequest): Promise<AuthorizedPreview> => {
      const operation = operationOf(request.operationId, request.input)
      const built = buildRequest(operation, request.input, target)
      const { request: preview, note } = await dryRunPreview(built, client.auth)
      return note === undefined ? { request: preview } : { request: preview, note }
    },
    route: (operationId, input) => {
      const operation = operationOf(operationId, input)
      const prefix = enginePrefix(target.engine, operation.engineScoped)
      return `${operation.method} ${prefix}${expandPath(operation, input.pathArgs)}`
    },
  }
}
