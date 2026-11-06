import { onTestFinished } from "vitest"

export const REST_URL = "http://camunda.test/v2"
export const TOPOLOGY = { route: "GET /topology", answer: { gatewayVersion: "8.10.8" } }

export interface RestRoute {
  readonly route: string
  readonly when?: (body: string) => boolean
  readonly answer: unknown
}

export interface SentRequest {
  readonly route: string
  readonly body: string
  readonly authorization: string | null
  readonly redirect: Request["redirect"]
}

export interface FakeCamundaRest {
  readonly send: typeof fetch
  readonly requests: SentRequest[]
  bodiesOf(route: string): unknown[]
}

export function jsonAnswer(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function problem(status: number, title: string, detail: string): Response {
  return jsonAnswer({ type: "about:blank", title, status, detail }, status)
}

export function page(items: readonly unknown[], extra: Record<string, unknown> = {}) {
  return {
    items,
    page: {
      totalItems: items.length,
      hasMoreTotalItems: false,
      startCursor: null,
      endCursor: null,
      ...extra,
    },
  }
}

export interface SearchBody {
  readonly filter: Readonly<Record<string, unknown>>
  readonly sort?: readonly unknown[]
  readonly page: { readonly limit: number; readonly after?: string }
}

export function searchOf(body: string): SearchBody {
  return JSON.parse(body) as SearchBody
}

export function pagedByCursor(rows: readonly unknown[]): (body: string) => unknown {
  return (body) => {
    const { limit, after } = searchOf(body).page
    const from = after === undefined ? 0 : Number(after)
    const items = rows.slice(from, from + limit)
    return page(items, {
      totalItems: Math.min(rows.length, 10_000),
      hasMoreTotalItems: rows.length > 10_000,
      endCursor: items.length === 0 ? null : String(from + items.length),
    })
  }
}

async function responseOf(answer: unknown, body: string): Promise<Response> {
  if (typeof answer === "function") {
    return responseOf(await (answer as (body: string) => unknown)(body), body)
  }
  return answer instanceof Response ? answer.clone() : jsonAnswer(answer)
}

export function fakeCamundaRest(routes: readonly RestRoute[]): FakeCamundaRest {
  const requests: SentRequest[] = []
  const hit = new Set<RestRoute>()
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const body = await request.text()
    const route = `${request.method} ${url.pathname.replace(new URL(REST_URL).pathname, "")}`
    requests.push({
      route,
      body,
      authorization: request.headers.get("Authorization"),
      redirect: request.redirect,
    })
    const match = routes.find(
      (candidate) => candidate.route === route && (candidate.when?.(body) ?? true),
    )
    if (match === undefined) {
      return problem(404, "Not Found", `No endpoint ${route}.`)
    }
    hit.add(match)
    return responseOf(match.answer, body)
  }
  onTestFinished(() => {
    const unused = routes.filter((route) => !hit.has(route)).map((route) => route.route)
    if (unused.length > 0) {
      throw new Error(`fake Camunda routes never hit: ${unused.join(" | ")}`)
    }
  })
  return {
    send,
    requests,
    bodiesOf: (route) =>
      requests
        .filter((request) => request.route === route)
        .map((request) => JSON.parse(request.body) as unknown),
  }
}
