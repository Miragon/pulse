import { onTestFinished } from "vitest"

export const REST_URL = "http://engine.test/engine-rest"

export interface RestRoute {
  readonly route: string
  readonly when?: (url: URL, body: string) => boolean
  readonly answer: unknown
}

export interface SentRequest {
  readonly route: string
  readonly query: Readonly<Record<string, string>>
  readonly body: string
  readonly authorization: string | null
  readonly redirect: Request["redirect"]
}

export interface FakeEngineRest {
  readonly send: typeof fetch
  readonly requests: SentRequest[]
}

export function jsonAnswer(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function engineFailure(status: number, type: string, message: string): Response {
  return jsonAnswer({ type, message }, status)
}

function responseOf(answer: unknown): Response {
  return answer instanceof Response ? answer.clone() : jsonAnswer(answer)
}

function routeOf(request: Request, url: URL): string {
  return `${request.method} ${url.pathname.replace(new URL(REST_URL).pathname, "")}`
}

export function fakeEngineRest(routes: readonly RestRoute[]): FakeEngineRest {
  const requests: SentRequest[] = []
  const hit = new Set<RestRoute>()
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const body = await request.text()
    const route = routeOf(request, url)
    requests.push({
      route,
      query: Object.fromEntries(url.searchParams),
      body,
      authorization: request.headers.get("Authorization"),
      redirect: request.redirect,
    })
    const match = routes.find(
      (candidate) => candidate.route === route && (candidate.when?.(url, body) ?? true),
    )
    if (match === undefined) {
      return engineFailure(404, "NotFoundException", `no fake route for ${route}`)
    }
    hit.add(match)
    return responseOf(match.answer)
  }
  onTestFinished(() => {
    const unused = routes.filter((route) => !hit.has(route)).map((route) => route.route)
    if (unused.length > 0) {
      throw new Error(`fake engine routes never hit: ${unused.join(" | ")}`)
    }
  })
  return { send, requests }
}
