/**
 * Engine access of the workflow commands: catalog operations sent through
 * `buildRequest` + `sendRequest` exactly like `ping`, so `--engine`, auth, `-H`, `--timeout`,
 * `--verbose` traces, redirect refusal and the error hints apply unchanged, and hints name the
 * generated command of the request (`pulse task complete`). The read rules (paging, missing
 * resources, text answers) are the engine port's of @miragon/pulse-engine-core.
 */

import {
  createEnginePort,
  type EngineFailure,
  type EngineTransport,
  Slots,
} from "@miragon/pulse-engine-core"
import { findByOperationId } from "../catalog/catalog.js"
import type { Catalog, OperationSpec } from "../catalog/types.js"
import type { AuthorizedPreview, EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { PulseCliError } from "../errors.js"
import type { ClientOptions } from "../http/client.js"
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

/**
 * Engine 404s mean "missing"; routing 404s (a wrong REST root) have no engine type. The same rule
 * as engine-core's `isMissing` over `cliFailure` (a QueryParamException 404 maps to
 * HTTP_CLIENT_ERROR, never NOT_FOUND); engine.test.ts holds the two in agreement.
 */
export function isMissing(error: unknown): boolean {
  if (!(error instanceof PulseCliError) || error.code !== "NOT_FOUND") return false
  const type = error.details.engineType
  return type !== undefined && type !== "NotFoundException"
}

/** The engine answer of an HTTP error: every error `call` throws for a response has a status. */
function cliFailure(error: unknown): EngineFailure | undefined {
  if (!(error instanceof PulseCliError) || error.details.status === undefined) return undefined
  const { status, engineType, engineMessage } = error.details
  return { status, ...compact({ engineType, engineMessage }) }
}

function jsonValue(result: OperationResult): unknown {
  return result.kind === "json" ? result.value : undefined
}

class CatalogTransport implements EngineTransport<OperationResult> {
  private readonly slots = new Slots()

  constructor(
    private readonly catalog: Catalog,
    private readonly target: Target,
    private readonly client: ClientOptions,
  ) {}

  private operation(operationId: string, input: OperationInput): OperationSpec {
    const operation = findByOperationId(this.catalog, operationId)
    if (operation === undefined) {
      throw new PulseCliError("INTERNAL", `The catalog has no operation ${operationId}`)
    }
    for (const [key, value] of Object.entries(input.query)) {
      const known = operation.params.some((param) => param.in === "query" && param.name === key)
      if (value !== undefined && !known) {
        throw new PulseCliError("INTERNAL", `${operationId} has no query parameter ${key}`)
      }
    }
    return operation
  }

  async send(operationId: string, input: OperationInput): Promise<OperationResult> {
    const operation = this.operation(operationId, input)
    const request = buildRequest(operation, input, this.target)
    return this.slots.run(() =>
      sendRequest(request, this.client, commandRef(operation, this.catalog)),
    )
  }

  json(result: OperationResult): unknown {
    return jsonValue(result)
  }

  text(result: OperationResult): string | undefined {
    return result.kind === "text" ? result.text : undefined
  }

  failure(error: unknown): EngineFailure | undefined {
    return cliFailure(error)
  }

  async preview(request: PlannedRequest): Promise<AuthorizedPreview> {
    const operation = this.operation(request.operationId, request.input)
    const built = buildRequest(operation, request.input, this.target)
    const { request: preview, note } = await dryRunPreview(built, this.client.auth)
    return note === undefined ? { request: preview } : { request: preview, note }
  }

  route(operationId: string, input: OperationInput): string {
    const operation = this.operation(operationId, input)
    const prefix = enginePrefix(this.target.engine, operation.engineScoped)
    return `${operation.method} ${prefix}${expandPath(operation, input.pathArgs)}`
  }
}

export function enginePort(catalog: Catalog, target: Target, client: ClientOptions): EnginePort {
  const transport = new CatalogTransport(catalog, target, client)
  return {
    ...createEnginePort(transport),
    call: (operationId, input) => transport.send(operationId, input),
    preview: (request) => transport.preview(request),
    route: (operationId, input) => transport.route(operationId, input),
  }
}
