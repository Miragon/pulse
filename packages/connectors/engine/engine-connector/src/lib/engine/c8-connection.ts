/**
 * The server's own wire to a Camunda 8 cluster, as the SDK client is its wire to a Camunda 7
 * engine (engine-connection.ts): per configured engine, once at boot, a credential
 * (credentials.ts: none, Basic, or a bearer token of the client credentials grant from one token
 * source per engine) and a read-only transport (@miragon/pulse-http) under c8-core's transport
 * port. Every request reads (a search is a POST that reads), JSON stays lossless (an integer
 * beyond 2^53 keeps its digits as a string), and each request of a call aborts with the caller's
 * signal. A failed request rejects with the transport's `HttpFailure` or the token source's
 * `TokenFailure` as they are; `failure` only copies their fields for c8-core, which decides each
 * failure's kind, a cluster's title and detail masked with the client's secret too (the issued
 * token the transport masks as the request's own secret, the client's secret in the token
 * endpoint's answer the token source). c8-errors.ts words them for the model.
 */

import { USER_AGENT } from "@miragon/pulse-c7-client"
import type {
  CamundaAnsweredFailure,
  CamundaFailure,
  CamundaTokenFailure,
  CamundaTransport,
} from "@miragon/pulse-c8-core"
import {
  clipText,
  createHttp,
  decodeText,
  type Http,
  HttpFailure,
  type HttpRequest,
  joinUrl,
  MAX_ANSWER_BYTES,
  maskSecrets,
  mediaTypeOf,
  parseJson,
  type Platform,
  secretForms,
} from "@miragon/pulse-http"
import { TokenFailure } from "@miragon/pulse-http/oauth"
import type {
  EngineAuth,
  EngineAuthType,
  EngineClientSettings,
  EngineEntry,
} from "../../engine-provider.js"
import { credentialFor, SERVER_PLATFORM } from "./credentials.js"
import { DEFAULT_ENGINE_TIMEOUT_MS } from "./engine-connection.js"

/** How the server signs in to a Camunda 8 cluster: not at all, Basic, or client credentials. */
export type C8AuthType = Extract<EngineAuthType, "none" | "basic" | "clientCredentials">

/** The sign-in of a Camunda 8 cluster, resolved from its profile at boot. */
export type C8Auth = EngineAuth & { readonly type: C8AuthType }

const JSON_TYPE = "application/json"
/** A diagram's XML, or the problem the cluster states as JSON. */
const XML_TYPES = "text/xml, application/json"

/**
 * The token endpoint's URL cannot be used (no absolute http(s) URL, or one with a user): the
 * token source's RangeError, which names no part of the URL, as its cause.
 */
export class UnusableTokenEndpointError extends Error {
  override readonly name = "UnusableTokenEndpointError"

  constructor(cause: RangeError) {
    super(cause.message, { cause })
  }
}

/** One configured Camunda 8 engine as the server reaches it. */
export interface C8Connection {
  readonly engineId: string
  readonly authType: C8AuthType
  /** The transport of one call: each of its requests aborts with `signal`. */
  transport(signal?: AbortSignal): CamundaTransport
  /** What a failed request rejected with, as c8-core reads it; undefined for any other error. */
  failure(error: unknown): CamundaFailure | undefined
}

/** A JSON value, else undefined. */
function jsonOf(text: string): unknown {
  try {
    return parseJson(text)
  } catch {
    return undefined
  }
}

/** The `title` of an RFC 9457 problem the answer states as JSON. */
function titleOf(failure: HttpFailure): string | undefined {
  const answer = failure.answer
  if (answer === undefined || !mediaTypeOf(answer.contentType).includes("json")) return undefined
  const problem = jsonOf(decodeText(answer))
  if (typeof problem !== "object" || problem === null || Array.isArray(problem)) return undefined
  const title = (problem as Readonly<Record<string, unknown>>).title
  return typeof title === "string" && title.trim() !== "" ? title : undefined
}

/** An error answer: its status, its problem's title and what it states, masked and clipped. */
function answeredFields(failure: HttpFailure, forms: readonly string[]): CamundaAnsweredFailure {
  const { type, message } = failure.problem ?? {}
  const detail = clipText(maskSecrets([type, message].filter(Boolean).join(": "), forms))
  const title = titleOf(failure)
  return {
    kind: "answered",
    status: failure.status ?? 0,
    title: title === undefined ? undefined : clipText(maskSecrets(title, forms)),
    detail: detail === "" ? undefined : detail,
    redirect: false,
  }
}

/**
 * The fields of a transport failure: an answer (an error status, a 401, a redirect) as answered,
 * so c8-core reads its status, never as a transport reason; every other reason as it is.
 */
function httpFields(failure: HttpFailure, forms: readonly string[]): CamundaFailure {
  switch (failure.reason) {
    case "status":
    case "unauthorized":
      return answeredFields(failure, forms)
    case "redirect":
      return {
        kind: "answered",
        status: failure.status ?? 0,
        title: undefined,
        detail: undefined,
        redirect: true,
      }
    default:
      return { kind: "transport", reason: failure.reason, code: failure.code }
  }
}

/**
 * The fields of the token endpoint's refusal or failure. Its code is safe as the token source
 * makes it: the request's secrets, the client's among them, masked in the answer, and the rest
 * reduced to a code's characters.
 */
function tokenFields(failure: TokenFailure): CamundaTokenFailure {
  const { cause } = failure
  return {
    kind: "token",
    trouble: failure.kind,
    status: failure.status,
    code: failure.code,
    problem: failure.problem,
    holdMs: failure.holdMs,
    capBytes:
      failure.kind === "too-large" && cause instanceof HttpFailure ? cause.limit : undefined,
  }
}

/** What c8-core reads of `error`: the fields of a failure of this wire, else undefined. */
function fieldsOf(error: unknown, forms: readonly string[]): CamundaFailure | undefined {
  if (error instanceof HttpFailure) return httpFields(error, forms)
  if (error instanceof TokenFailure) return tokenFields(error)
  if (error instanceof UnusableTokenEndpointError) {
    return { kind: "transport", reason: "invalid-request", code: undefined }
  }
  return undefined
}

/** The token source's RangeError (an unusable token endpoint URL) as this wire's own error. */
function unusable(error: unknown): never {
  throw error instanceof RangeError ? new UnusableTokenEndpointError(error) : error
}

/** The transport of one call over `http`: reads only, each request aborting with `signal`. */
function transportOver(
  http: Http,
  signal: AbortSignal | undefined,
  failure: (error: unknown) => CamundaFailure | undefined,
): CamundaTransport {
  const request = (method: string, path: string, accept: string, body?: string): HttpRequest => ({
    method,
    url: joinUrl(http.root, path),
    intent: "read",
    headers: { Accept: accept, ...(body === undefined ? {} : { "Content-Type": JSON_TYPE }) },
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
  })
  return {
    get: (path) => http.json(request("GET", path, JSON_TYPE), "string").catch(unusable),
    post: (path, body) =>
      http.json(request("POST", path, JSON_TYPE, JSON.stringify(body)), "string").catch(unusable),
    text: async (path) => {
      const answer = await http.call(request("GET", path, XML_TYPES)).catch(unusable)
      return decodeText(answer)
    },
    failure,
  }
}

/**
 * The connection of `entry`: its credential (one that cannot be sent fails here, at boot), the
 * deadline of `settings`, the 64 MiB cap, every request a read, the server's User-Agent. The
 * token source sends over `platform` as the transport does, so a test's clock reaches both.
 */
export function createC8Connection(
  entry: Pick<EngineEntry, "id" | "baseUrl">,
  auth: C8Auth,
  settings: Pick<EngineClientSettings, "timeoutMs"> & {
    /** The size cap in bytes: 64 MiB; the transport's conformance cases set a smaller one. */
    readonly maxAnswerBytes?: number
  } = {},
  platform: Platform = SERVER_PLATFORM,
): C8Connection {
  const http = createHttp(
    {
      url: entry.baseUrl,
      credential: credentialFor(entry.id, auth, platform),
      timeoutMs: settings.timeoutMs ?? DEFAULT_ENGINE_TIMEOUT_MS,
      maxAnswerBytes: settings.maxAnswerBytes ?? MAX_ANSWER_BYTES,
      readOnly: true,
      userAgent: USER_AGENT,
    },
    platform,
  )
  const forms = auth.type === "clientCredentials" ? secretForms([auth.clientSecret]) : []
  const failure = (error: unknown) => fieldsOf(error, forms)
  return {
    engineId: entry.id,
    authType: auth.type,
    transport: (signal) => transportOver(http, signal, failure),
    failure,
  }
}
