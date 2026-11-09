import { createClient } from "./generated/client/client.gen.js"
import type { Client } from "./generated/client/types.gen.js"
import { createClientConfig } from "./hey-api.js"

export type { Client }

export interface EngineClientOptions {
  /** The REST API root, e.g. `http://localhost:8080/engine-rest`. */
  readonly baseUrl: string
  /**
   * What every request goes out through: hey-api calls it with the finished `Request`. The
   * transport behind it owns the wire (credentials, deadline, redirects, size cap, failures),
   * e.g. `asFetch` of `@miragon/pulse-http`; the client adds nothing to it.
   */
  readonly fetch: typeof fetch
  /**
   * Checks each call's resolved options (its `path`, `query` and `body` values) before the URL
   * is built: a path value `.` or `..` is gone once the `Request` resolved it, so a rule on path
   * values runs here. Whatever it throws rejects the call, nothing sent.
   */
  readonly requestValidator?: (options: unknown) => Promise<unknown>
}

/** The client's methods that send a request; each refuses a call that brings its own wire. */
const SENDING = [
  "connect",
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
  "request",
] as const

/**
 * The options only the client sets. hey-api takes a call's options over the client's
 * (`{ ...config, ...options }`), so a call that brings one of them, even as `undefined`, would
 * leave the client's out: its own `fetch` sends without the transport's credential, deadline and
 * checks, its own `requestValidator` skips the rule on path values (`..` would reach another
 * resource), and an `auth` signs the request with a credential of its own. The generated SDK's
 * own `security` stays a call's option: without an `auth` it adds no header.
 */
const CLIENT_OWNED = ["fetch", "requestValidator", "auth"] as const

/** The first option of {@link CLIENT_OWNED} that `options` brings, if any. */
function ownOption(options: unknown): (typeof CLIENT_OWNED)[number] | undefined {
  if (typeof options !== "object" || options === null) return undefined
  return CLIENT_OWNED.find((key) => Object.hasOwn(options, key))
}

function refusal(option: (typeof CLIENT_OWNED)[number]): TypeError {
  return new TypeError(
    `an engine call may not bring its own ${option}: the client's fetch carries the ` +
      "credential, the deadline and the checks of every request",
  )
}

type Send = (options: unknown) => Promise<unknown>

/** `send`, refusing a call that brings an option of {@link CLIENT_OWNED}. */
function refusingOwnOptions<T>(send: T): T {
  const call = send as Send
  return ((options: unknown) => {
    const own = ownOption(options)
    return own === undefined ? call(options) : Promise.reject(refusal(own))
  }) as T
}

/** `client` with every sending method (and `setConfig`) refusing a call's own wire options. */
function withItsWireOnly(client: Client): Client {
  const guarded: Client = { ...client }
  for (const method of SENDING) {
    guarded[method] = refusingOwnOptions(client[method]) as never
  }
  const sse = { ...client.sse }
  for (const method of Object.keys(sse) as (keyof typeof sse)[]) {
    sse[method] = refusingOwnOptions(sse[method])
  }
  guarded.sse = sse
  guarded.setConfig = (config) => {
    const own = ownOption(config)
    if (own !== undefined) throw refusal(own)
    return client.setConfig(config)
  }
  return guarded
}

/**
 * A client of one engine over the `fetch` it is given. All defaults (JSON content negotiation
 * headers, the User-Agent, `throwOnError`, `responseStyle`) come from `createClientConfig` in
 * src/hey-api.ts (the same function the generated default client uses), so runtime behavior and
 * the generated SDK types stay in sync. The client keeps no wire rule of its own: who signs a
 * request, how long it may take, that a redirect is never followed and what a failure says
 * belong to the `fetch` and to the error interceptors its caller installs
 * (`client.interceptors.error`). A call (or `setConfig`) that brings a `fetch`, a
 * `requestValidator` or an `auth` of its own is refused, since it would leave the given ones out.
 */
export function createEngineClient(options: EngineClientOptions): Client {
  return withItsWireOnly(
    createClient(
      createClientConfig({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        ...(options.requestValidator === undefined
          ? {}
          : { requestValidator: options.requestValidator }),
      }),
    ),
  )
}

/** The methods a caller's cancellation may abort: reads, never writes. */
const CANCELLABLE_METHODS = ["get", "head", "options"] as const

/**
 * A view of `client` whose READS honor the caller's `signal` (an MCP
 * request's `ctx.signal`, aborted when the MCP client cancels or
 * disconnects), on top of the deadline of the transport behind its `fetch`. Writes never see it:
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
