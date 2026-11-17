import { type CamundaClient, RestCamundaClient } from "@miragon/pulse-c8-core"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { onTestFinished } from "vitest"
import { CamundaTransports } from "../../src/camunda-transports.js"
import { C8Adapter } from "../../src/index.js"

export const REST_URL = "http://camunda.test/v2"
export const TOPOLOGY = { route: "GET /topology", answer: { gatewayVersion: "8.10.8" } }
export const NONE: EngineCredentials = { kind: "none" }

export interface RestRoute {
  readonly route: string
  readonly when?: (body: string) => boolean
  readonly answer: unknown
}

export interface SentRequest {
  readonly route: string
  readonly target: string
  readonly body: string
  readonly accept: string | null
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
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  })
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
    const target = url.pathname.replace(new URL(REST_URL).pathname, "")
    const route = `${request.method} ${decodeURIComponent(target)}`
    requests.push({
      route,
      target,
      body,
      accept: request.headers.get("Accept"),
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

export function clientWith(
  routes: readonly RestRoute[],
  credentials: EngineCredentials = NONE,
): { readonly camunda: FakeCamundaRest; readonly client: CamundaClient } {
  const camunda = fakeCamundaRest(routes)
  const transport = new CamundaTransports(camunda.send, () => Date.now()).of({
    endpoint: REST_URL,
    credentials,
  })
  return { camunda, client: new RestCamundaClient(transport) }
}

export function runtimeWith(
  routes: readonly RestRoute[],
  credentials: EngineCredentials = NONE,
): { readonly camunda: FakeCamundaRest; readonly runtime: ProcessRuntime } {
  const camunda = fakeCamundaRest(routes)
  const runtime = new C8Adapter(camunda.send).runtime({ endpoint: REST_URL, credentials })
  return { camunda, runtime }
}

export function runtimeOn(send: typeof fetch, endpoint = REST_URL): ProcessRuntime {
  return new C8Adapter(send).runtime({ endpoint, credentials: NONE })
}
