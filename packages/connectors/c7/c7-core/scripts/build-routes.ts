/** Builds the route table from the spec. Pure: same document, same table. */

import type { Route, RouteMethod, Routes } from "../src/route.js"
import { BULK_OPERATIONS, classifyEffect, EFFECT_OVERRIDES } from "./effects.js"
import {
  type Content,
  type OpenApiDocument,
  type Operation,
  propertyNames,
  refName,
  resolve,
} from "./openapi.js"

/** The path item keys that are operations, by their method. */
const METHODS: ReadonlyMap<string, RouteMethod> = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["delete", "DELETE"],
  ["options", "OPTIONS"],
])

/** The path item keys that are no operation. */
const NOT_OPERATIONS: ReadonlySet<string> = new Set([
  "parameters",
  "summary",
  "description",
  "servers",
])

/** The paths outside a named engine: they never answer below `/engine/{name}`. */
const ENGINE_INDEPENDENT_PATHS: ReadonlySet<string> = new Set(["/engine", "/version"])

/** The method of a path item key, or undefined for one that is no operation; fails on others. */
function methodOf(key: string, path: string): RouteMethod | undefined {
  if (NOT_OPERATIONS.has(key)) return undefined
  const method = METHODS.get(key)
  if (method === undefined) throw new Error(`${path}: unsupported path item key "${key}"`)
  return method
}

/** The answers of the operation's success statuses (2xx), their `$ref`s resolved. */
function successAnswers(spec: OpenApiDocument, operation: Operation): Content[] {
  return Object.entries(operation.responses ?? {})
    .filter(([status]) => status.startsWith("2"))
    .map(([, answer]) => resolve(answer, spec.components?.responses))
}

/** The property names of the operation's JSON request body; undefined without one. */
function bodyProperties(spec: OpenApiDocument, operation: Operation): string[] | undefined {
  if (operation.requestBody === undefined) return undefined
  const body = resolve(operation.requestBody, spec.components?.requestBodies)
  const schema = body.content?.["application/json"]?.schema
  return schema === undefined ? undefined : propertyNames(schema, spec.components?.schemas)
}

/** The route of one operation: its effect by the effect rule, its media types from its answers. */
function buildRoute(
  spec: OpenApiDocument,
  path: string,
  method: RouteMethod,
  operation: Operation,
) {
  const { operationId } = operation
  if (operationId === undefined) throw new Error(`${method} ${path} needs an operationId`)
  const answers = successAnswers(spec, operation)
  const answerSchemas = answers.flatMap(({ content }) => {
    const ref = content?.["application/json"]?.schema?.$ref
    return typeof ref === "string" ? [refName(ref)] : []
  })
  const bodyNames = bodyProperties(spec, operation)
  const effect = classifyEffect({
    operationId,
    method,
    path,
    bodyProperties: bodyNames,
    answerSchemas,
  })
  const accepts = [...new Set(answers.flatMap(({ content }) => Object.keys(content ?? {})))]
  const engineScoped = !ENGINE_INDEPENDENT_PATHS.has(path)
  return { operationId, method, path, effect, engineScoped, accepts } satisfies Route
}

/** Every operation of the spec, in path order. */
function routesOf(spec: OpenApiDocument): Route[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).flatMap(([key, operation]) => {
      const method = methodOf(key, path)
      return method === undefined ? [] : [buildRoute(spec, path, method, operation as Operation)]
    }),
  )
}

/** Fails when `ids` name an operation the spec lacks: a rule for it would be stale. */
function assertKnown(routes: Routes, ids: Iterable<string>, what: string): void {
  const stale = [...ids].filter((id) => !Object.hasOwn(routes, id))
  if (stale.length > 0) throw new Error(`${what} for unknown operations: ${stale.join(", ")}`)
}

/** Locale-independent order, so the generated file is the same on every machine. */
function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The route of every operation of the spec, by operation id in code unit order. Fails on an
 * operation without an id, on an id two operations share, on a path item key it does not know and
 * on a bulk rule or effect override for an operation the spec lacks.
 */
export function buildRoutes(spec: OpenApiDocument): Routes {
  const routes = routesOf(spec).sort((a, b) => compareText(a.operationId, b.operationId))
  const table: Record<string, Route> = {}
  for (const route of routes) {
    if (Object.hasOwn(table, route.operationId)) {
      throw new Error(`Two operations share the operationId ${route.operationId}`)
    }
    table[route.operationId] = route
  }
  assertKnown(table, BULK_OPERATIONS, "Bulk classification")
  assertKnown(table, EFFECT_OVERRIDES.keys(), "Effect overrides")
  return table
}

/** The routes of `ids`, in code unit order; fails on an id the table lacks. */
export function pickRoutes(routes: Routes, ids: readonly string[]): Routes {
  const picked: Record<string, Route> = {}
  for (const id of [...new Set(ids)].sort(compareText)) {
    const route = Object.hasOwn(routes, id) ? routes[id] : undefined
    if (route === undefined) throw new Error(`Routes for unknown operations: ${id}`)
    picked[id] = route
  }
  return picked
}
