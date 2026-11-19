/**
 * A page's client of the web app's API (src/protocol/web.ts), which a Pulse server serves under
 * `/app` beside its sign-in: `readWebSession()` reads who is signed in and the session's CSRF
 * token, and `webToolCaller(session)` is the `callTool` a page hands `mountApp` (or `mountPage`),
 * each call a POST to `/app/api/call` that carries the token, which the server forwards to `/mcp`
 * with the session's bearer token. Only the page's own cookie travels with it, and no token ever reaches the page.
 */
import type { ToolResult } from "../protocol/tool-result.js"
import {
  WEB_CODES,
  WEB_CSRF_HEADER,
  WEB_PATHS,
  type WebCall,
  type WebCallAnswer,
  type WebCode,
  type WebRefusal,
  type WebSessionInfo,
} from "../protocol/web.js"
import type { ToolCaller } from "./browser-view-host.js"

export interface WebClientOptions {
  /** What the client sends with; default: the page's own `fetch`. */
  fetch?: typeof fetch
}

export interface WebToolCallerOptions extends WebClientOptions {
  /** Told when a call finds the session gone, so the page can offer to sign in again. */
  onSignedOut?: () => void
}

/**
 * A refusal of the web app's API, its status and, where a page acts on it, its code
 * (`signed_out`, `WEB_NOT_FOR_PAGES`, `WEB_READ_ONLY`); its message is the server's.
 */
export class WebApiError extends Error {
  readonly status: number
  readonly code: WebCode | undefined

  constructor(status: number, refusal: Partial<WebRefusal> | undefined) {
    super(refusal?.message ?? `The web app's API answered HTTP ${status}.`)
    this.name = "WebApiError"
    this.status = status
    this.code = refusal?.code
  }
}

const sender = (options: WebClientOptions): typeof fetch =>
  options.fetch ?? ((input, init) => fetch(input, init))

async function refusalOf(response: Response): Promise<WebApiError> {
  const body: unknown = await response.json().catch(() => undefined)
  const refusal = typeof body === "object" && body !== null ? (body as WebRefusal) : undefined
  return new WebApiError(response.status, refusal)
}

/** Who is signed in, the CSRF token and when the session ends; `undefined` without a session. */
export async function readWebSession(
  options: WebClientOptions = {},
): Promise<WebSessionInfo | undefined> {
  const response = await sender(options)(WEB_PATHS.session, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
  if (response.status === 401) return undefined
  if (!response.ok) throw await refusalOf(response)
  return (await response.json()) as WebSessionInfo
}

/**
 * The page's caller of the server's tools over the session `readWebSession` read: it resolves with
 * the tool's result (an `isError` one too) and rejects with a {@link WebApiError} where the API
 * refuses the call, after telling `onSignedOut` when the session is gone.
 */
export function webToolCaller(
  session: Pick<WebSessionInfo, "csrf">,
  options: WebToolCallerOptions = {},
): ToolCaller {
  const send = sender(options)
  return async (name, args): Promise<ToolResult> => {
    const call: WebCall = { name, arguments: args }
    const response = await send(WEB_PATHS.call, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [WEB_CSRF_HEADER]: session.csrf,
      },
      body: JSON.stringify(call),
    })
    if (response.ok) return ((await response.json()) as WebCallAnswer).result
    const error = await refusalOf(response)
    if (error.code === WEB_CODES.signedOut) options.onSignedOut?.()
    throw error
  }
}
