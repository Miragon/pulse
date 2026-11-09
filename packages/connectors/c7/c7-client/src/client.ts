import { createClient } from "./generated/client/client.gen.js"
import type { Client } from "./generated/client/types.gen.js"
import { createClientConfig } from "./hey-api.js"
import { toEngineRequestError } from "./engine-error.js"

export type { Client }

export type EngineAuthType = "basic" | "bearer" | "passthrough" | "none"

/** Default per-request deadline for engine calls (`timeoutMs`). */
export const DEFAULT_ENGINE_TIMEOUT_MS = 30_000

/** The largest delay a Node timer holds; a longer one would fire immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647

export interface EngineClientOptions {
  baseUrl: string
  /**
   * Id of the configured engine this client talks to. Carried into every
   * error message (`… (engine prod-a)`) so the model can tell WHICH engine
   * failed in a multi-engine fleet; left out of the message when unset.
   */
  engineId?: string
  /**
   * Per-request deadline in ms (default {@link DEFAULT_ENGINE_TIMEOUT_MS}),
   * covering connect, headers and body. A hung engine then fails the call
   * with a timeout error instead of holding it for undici's minutes-long
   * defaults.
   */
  timeoutMs?: number
  authType?: EngineAuthType
  username?: string
  password?: string
  token?: string
  /**
   * Token source for `authType: "passthrough"`, called on every request; the
   * returned bearer token (without the `Bearer ` scheme prefix) is sent as
   * the `Authorization` header. When it returns `undefined` (or no provider
   * is given), the request is sent without auth, like `authType: "none"`;
   * an engine with REST auth enabled then answers 401.
   */
  tokenProvider?: () => string | undefined
}

function buildAuthHeader(options: EngineClientOptions): Record<string, string> {
  const { authType = "none", username, password, token } = options
  if (authType === "basic" && username && password) {
    const encoded =
      typeof btoa === "function"
        ? btoa(`${username}:${password}`)
        : Buffer.from(`${username}:${password}`).toString("base64")
    return { Authorization: `Basic ${encoded}` }
  }
  if (authType === "bearer" && token) {
    return { Authorization: `Bearer ${token}` }
  }
  // "passthrough" deliberately sets no static header: the per-request
  // interceptor below owns the Authorization header instead.
  return {}
}

/** The remedy a 401 message names: it depends on where the credential came from. */
function unauthorizedHint(options: EngineClientOptions): string {
  switch (options.authType ?? "none") {
    case "passthrough":
      return options.tokenProvider?.()
        ? "The engine rejected the forwarded bearer token."
        : "The MCP request carried no bearer token to pass through."
    case "none":
      return "The engine requires authentication, but none is configured."
    default:
      return "The engine rejected the configured credentials."
  }
}

function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_ENGINE_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(
      `Engine request timeout must be a positive integer of at most ${MAX_TIMEOUT_MS} ms, got ${timeoutMs}`,
    )
  }
  return timeoutMs
}

/**
 * The credentials a request carried, for masking in error text (an engine or
 * proxy may quote them back): the configured password/token and whatever the
 * request's own `Authorization` header holds (the Basic value, a static or a
 * passed-through bearer token).
 */
function credentialsOf(options: EngineClientOptions, request: Request | undefined) {
  const authorization = request?.headers.get("Authorization") ?? undefined
  return [options.password, options.token, authorization?.replace(/^\S+\s+/, "")]
}

/**
 * Per-engine client factory. All defaults (JSON content negotiation headers,
 * `throwOnError`, `responseStyle`) come from `createClientConfig` in
 * src/hey-api.ts (the same function the generated default client uses), so
 * runtime behavior and the generated SDK types stay in sync.
 *
 * Every client, whatever its auth type, carries a per-request deadline in its
 * `fetch` (combined with a caller `signal`, see {@link withCallerSignal}),
 * never follows a redirect (a 3xx fails the call) and has an error
 * interceptor that maps every failure to an `EngineRequestError` (status,
 * exception type, engine message, engine id; credentials masked).
 *
 * The deadline binds the request as it LEAVES (after every request
 * interceptor), so an interceptor that returns a new `Request` can neither
 * detach it nor disguise it as a cancellation. A custom `fetch` (per call or
 * via `setConfig`) replaces the deadline with it: wrap
 * `client.getConfig().fetch` instead. Request interceptors should mutate the
 * request (`request.headers.set(…)`); one that returns a new `Request` keeps
 * the deadline, but the caller's signal reaches the new request only through
 * the dropped one (undici follows signals via a `WeakRef`), so after a
 * garbage collection a cancelled call runs on until the deadline.
 */
export function createEngineClient(options: EngineClientOptions): Client {
  const timeoutMs = resolveTimeout(options.timeoutMs)
  // Keyed by the request hey-api sends, i.e. the one its error interceptors
  // receive: tells OUR deadline from a caller's cancellation, and keeps the
  // timer alive exactly as long as hey-api holds that request (body read
  // included).
  const deadlines = new WeakMap<Request, AbortSignal>()
  const fetchWithDeadline = (request: Request): Promise<Response> => {
    const deadline = AbortSignal.timeout(timeoutMs)
    deadlines.set(request, deadline)
    return fetch(request, { signal: AbortSignal.any([request.signal, deadline]) })
  }
  const client = createClient(
    createClientConfig({
      baseUrl: options.baseUrl,
      headers: buildAuthHeader(options),
      // hey-api calls its `fetch` with the finished Request only.
      fetch: fetchWithDeadline as typeof fetch,
      // Redirects are NEVER followed, as in the CLI and the VS Code extension: a followed
      // 302/303 turns a write into a GET (of a login page that "succeeds"). A 3xx is an engine
      // error whose message tells the operator what to fix (engine-error.ts).
      redirect: "manual",
    }),
  )

  if (options.authType === "passthrough" && options.tokenProvider) {
    const { tokenProvider } = options
    // Not the hey-api `auth` option: the generated operations all declare the
    // `basic` security scheme, so `auth` would base64-mangle a bearer token.
    // The interceptor must only ever touch Authorization: the multipart
    // operations rely on an absent Content-Type for the boundary parameter.
    client.interceptors.request.use((request) => {
      const token = tokenProvider()
      if (token) {
        request.headers.set("Authorization", `Bearer ${token}`)
      }
      return request
    })
  }

  // Always on: hey-api throws the parsed error BODY (an ExceptionDto object,
  // the text, or `{}`), which the model would read as "[object Object]".
  client.interceptors.error.use((error, response, request) =>
    toEngineRequestError(error, {
      response,
      request,
      engineId: options.engineId,
      timeoutMs,
      timedOut: request ? deadlines.get(request)?.aborted === true : false,
      unauthorizedHint: response?.status === 401 ? unauthorizedHint(options) : undefined,
      secrets: credentialsOf(options, request),
    }),
  )
  return client
}

/** The methods a caller's cancellation may abort: reads, never writes. */
const CANCELLABLE_METHODS = ["get", "head", "options"] as const

/**
 * A view of `client` whose READS honor the caller's `signal` (an MCP
 * request's `ctx.signal`, aborted when the MCP client cancels or
 * disconnects), on top of the client's own deadline. Writes never see it:
 * aborting a started write cannot roll it back on the engine, it only turns
 * a known outcome into an unknown one. An explicit per-call `signal` wins.
 * Without a signal the client itself is returned.
 */
export function withCallerSignal(client: Client, signal: AbortSignal | undefined): Client {
  if (!signal) return client
  const bound: Client = { ...client }
  for (const method of CANCELLABLE_METHODS) {
    const call = client[method]
    bound[method] = ((callOptions: Parameters<typeof call>[0]) =>
      call({ ...callOptions, signal: callOptions.signal ?? signal })) as typeof call
  }
  return bound
}
