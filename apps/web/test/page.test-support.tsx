import { act } from "@testing-library/react"
import { vi } from "vitest"
import type { ViewComponent, ViewMap } from "@miragon/pulse-widget-shell/widgets"
import { startPage, type PageEnv } from "../src/start.js"

/**
 * The page as a browser starts it, over a fake of the server's routes under /app: its route, its
 * session, its frame and the view in it. Each test file calls `stopPage` after each test.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSION = { name: "Alice Adams", csrf: "csrf-1", expiresAt: 0 }

/** The view the page shows: the start its tool answered with. */
const Greeting: ViewComponent<{ greeting: string }> = ({ data }) => (
  <p data-testid="view">{data.greeting}</p>
)
const VIEWS: ViewMap = { engine_open_cockpit: Greeting as ViewComponent }

export const viewResult = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: { greeting: "Hi" },
}

export interface Server {
  session?: () => Response
  call?: (body: {
    name: string
    arguments?: Record<string, unknown>
  }) => Response | Promise<Response>
  logout?: () => Response | Promise<Response>
}

/** The path a request names. */
const pathOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url

/** The text of a request's body. */
export const bodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === "string" ? init.body : ""

/** The server's routes the page reaches, each answered as `server` says. */
export function fakeFetch(server: Server) {
  return vi.fn<typeof fetch>((input, init) => {
    const path = pathOf(input)
    if (path === "/app/api/session")
      return Promise.resolve(server.session?.() ?? Response.json(SESSION))
    if (path === "/app/api/call") {
      const body = JSON.parse(bodyOf(init)) as { name: string }
      return Promise.resolve(server.call?.(body) ?? Response.json({ result: viewResult }))
    }
    if (path === "/app/auth/logout") {
      return Promise.resolve(server.logout?.() ?? Response.json({ location: "/app/signed-out" }))
    }
    return Promise.reject(new Error(`No route ${path}`))
  })
}

let unmount: (() => void) | undefined

export async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Starts the page at `url` over `server`, in a container unless `inRoot`, with `views` (default
 * the greeting); its hands recorded.
 */
export async function start(
  url: string,
  server: Server = {},
  { inRoot = false, views = VIEWS }: { inRoot?: boolean; views?: ViewMap } = {},
) {
  const { pathname, search, origin } = new URL(url, "http://localhost")
  const fetch = fakeFetch(server)
  const assign = vi.fn<(url: string) => void>()
  const reload = vi.fn<() => void>()
  const env: PageEnv = { views, location: { pathname, search, origin }, fetch, assign, reload }
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = await startPage(inRoot ? env : { ...env, container })
  })
  await settled()
  return { fetch, assign, reload }
}

/** Unmounts the page and puts the document back. */
export async function stopPage(): Promise<void> {
  await act(async () => unmount?.())
  unmount = undefined
  document.body.innerHTML = ""
  document.documentElement.lang = ""
  document.documentElement.removeAttribute("class")
  document.title = ""
}

/** The page's calls of `tool`, with their arguments. */
export function callsOf(fetch: ReturnType<typeof fakeFetch>, tool: string): unknown[] {
  return fetch.mock.calls
    .filter(([path]) => path === "/app/api/call")
    .map(([, init]) => JSON.parse(bodyOf(init)) as { name: string; arguments?: unknown })
    .filter((call) => call.name === tool)
    .map((call) => call.arguments)
}
