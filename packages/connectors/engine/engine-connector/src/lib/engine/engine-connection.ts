/**
 * The one way the module reaches an engine: per configured engine, once at boot, a credential
 * (credentials.ts) and a transport (@miragon/pulse-http) under the generated SDK's client. The
 * transport owns the wire (the deadline to the last byte, no redirect, the 64 MiB cap, the
 * masked secrets, failure reasons as data); the route table of @miragon/pulse-c7-core says which
 * request only reads, so a reading POST never carries the write caveat; the SDK's
 * `requestValidator` refuses a path value `""`, `.` or `..` before the URL is built; and the
 * client's error interceptor words every failure for the model (engine-error.ts). The client
 * keeps no mechanics of its own and refuses a call that brings its own `fetch`,
 * `requestValidator` or `auth`.
 */

import { type Client, createEngineClient, USER_AGENT } from "@miragon/pulse-c7-client"
import { intentOf, routeOf } from "@miragon/pulse-c7-core"
import { ROUTES } from "@miragon/pulse-c7-core/routes"
import { createHttp, type Intent, MAX_ANSWER_BYTES, pathValueProblem } from "@miragon/pulse-http"
import type { EngineAuth, EngineClientSettings, EngineEntry } from "../../engine-provider.js"
import { credentialFor, unauthorizedHint } from "./credentials.js"
import { type EngineErrorContext, EngineRequestError, toEngineToolError } from "./engine-error.js"

/** The deadline of one engine request without `ENGINE_REQUEST_TIMEOUT_MS`: 30 s to the last byte. */
const DEFAULT_ENGINE_TIMEOUT_MS = 30_000

/** The path of `url` below `root` (`/process-instance/{id}`), or undefined outside it. */
export function pathUnder(root: string, url: string): string | undefined {
  const rootPath = new URL(root).pathname.replace(/\/+$/, "")
  const { pathname } = new URL(url)
  if (pathname !== rootPath && !pathname.startsWith(`${rootPath}/`)) return undefined
  return pathname.slice(rootPath.length)
}

/**
 * Whether an SDK request only reads: by the route the generated table holds for it, so
 * `POST /process-instance` (a query with a body) reads and an unknown POST writes.
 */
export function intentOfRequest(root: string, request: Request): Intent {
  const path = pathUnder(root, request.url)
  const route = path === undefined ? undefined : routeOf(ROUTES, request.method, path)
  return intentOf(route, request.method)
}

/** Why a path value cannot be sent, for the model: the value is "", "." or "..", never more. */
function pathValueError(value: string, ctx: EngineErrorContext): EngineRequestError | undefined {
  const problem = pathValueProblem(value)
  if (problem === undefined) return undefined
  const shown = problem === "empty" ? "an empty path value" : `the path value "${value}"`
  const engineMessage =
    `${shown} was refused before sending (${problem}): the URL would address another ` +
    "resource; nothing was sent"
  return new EngineRequestError(`${engineMessage} (engine ${ctx.engineId})`, {
    kind: "refused",
    engineMessage,
    engineId: ctx.engineId,
  })
}

/**
 * The SDK's `requestValidator`: refuses a call whose path values the URL would resolve away
 * (`/process-instance/..` reaches the REST root), before anything is built or sent.
 */
function refusePathValues(ctx: EngineErrorContext): (options: unknown) => Promise<void> {
  return (options) => {
    const path = (options as { path?: unknown }).path
    if (typeof path !== "object" || path === null) return Promise.resolve()
    for (const value of Object.values(path)) {
      const refused = typeof value === "string" ? pathValueError(value, ctx) : undefined
      if (refused !== undefined) return Promise.reject(refused)
    }
    return Promise.resolve()
  }
}

/**
 * The client of `entry` over its transport: the credential of `auth` (a credential that cannot
 * be sent fails here, at boot), the deadline of `settings`, the 64 MiB cap, integers beyond 2^53
 * as their exact digits, and every failure worded for the model.
 */
export function createEngineConnection(
  entry: Pick<EngineEntry, "id" | "baseUrl">,
  auth: EngineAuth,
  settings: EngineClientSettings & {
    /** The size cap in bytes: 64 MiB; the transport's conformance cases set a smaller one. */
    readonly maxAnswerBytes?: number
  } = {},
): Client {
  const http = createHttp(
    {
      url: entry.baseUrl,
      credential: credentialFor(entry.id, auth),
      timeoutMs: settings.timeoutMs ?? DEFAULT_ENGINE_TIMEOUT_MS,
      maxAnswerBytes: settings.maxAnswerBytes ?? MAX_ANSWER_BYTES,
      userAgent: USER_AGENT,
    },
    // Looked up per request, never at boot: the global `fetch` as it is then.
    { fetch: (input, init) => fetch(input, init), now: () => Date.now() },
  )
  const intent = (request: Request) => intentOfRequest(http.root, request)
  const ctx: EngineErrorContext = {
    engineId: entry.id,
    unauthorizedHint: unauthorizedHint(auth.type),
    intentOf: intent,
  }
  const client = createEngineClient({
    baseUrl: http.root,
    fetch: http.asFetch({ intentOf: intent, integers: "string" }),
    requestValidator: refusePathValues(ctx),
  })
  client.interceptors.error.use((error, response, request) =>
    toEngineToolError(error, response, ctx, request),
  )
  return client
}
