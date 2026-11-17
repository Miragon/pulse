import { onTestFinished } from "vitest"
import type { CamundaFailure } from "../../src/port/camunda-failure.js"
import type { CamundaTransport } from "../../src/port/camunda-transport.js"
import { type CamundaClient, RestCamundaClient } from "../../src/rest/index.js"

export const TOPOLOGY = { route: "GET /topology", answer: { gatewayVersion: "8.10.8" } }

export interface RestRoute {
  readonly route: string
  readonly when?: (body: string) => boolean
  readonly answer: unknown
}

export interface SentRequest {
  readonly route: string
  readonly target: string
  readonly body: string
}

export class FailedRequest extends Error {
  override readonly name = "FailedRequest"

  constructor(readonly failure: CamundaFailure) {
    super(`the transport failed: ${failure.kind}`)
  }
}

class FailedAnswer {
  constructor(readonly failure: CamundaFailure) {}
}

export function failed(failure: CamundaFailure): FailedAnswer {
  return new FailedAnswer(failure)
}

export function problem(status: number, title: string, detail: string): FailedAnswer {
  return failed({ kind: "answered", status, title, detail, redirect: false })
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
  readonly page: { readonly limit: number; readonly after?: string; readonly from?: number }
}

export function searchOf(body: string): SearchBody {
  return JSON.parse(body) as SearchBody
}

export function matchingIn(
  rows: readonly Readonly<Record<string, unknown>>[],
): (body: string) => unknown {
  return (body) => {
    const conditions = Object.entries(searchOf(body).filter)
    return page(
      rows.filter((row) =>
        conditions.every(([field, condition]) => {
          const among = (condition as { readonly $in?: readonly unknown[] }).$in
          return among === undefined || among.includes(row[field])
        }),
      ),
    )
  }
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

export function pagedByOffset(rows: readonly unknown[]): (body: string) => unknown {
  return (body) => {
    const { limit, from = 0 } = searchOf(body).page
    return { items: rows.slice(from, from + limit) }
  }
}

export class FakeCamundaRest implements CamundaTransport {
  readonly requests: SentRequest[] = []
  private readonly hit = new Set<RestRoute>()

  constructor(private readonly routes: readonly RestRoute[]) {
    onTestFinished(() => {
      const unused = routes.filter((route) => !this.hit.has(route)).map((route) => route.route)
      if (unused.length > 0) {
        throw new Error(`fake Camunda routes never hit: ${unused.join(" | ")}`)
      }
    })
  }

  async get(path: string): Promise<unknown> {
    return FakeCamundaRest.json(await this.answer("GET", path, ""))
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return FakeCamundaRest.json(await this.answer("POST", path, JSON.stringify(body)))
  }

  async text(path: string): Promise<string> {
    const answer = await this.answer("GET", path, "")
    return typeof answer === "string" ? answer : JSON.stringify(answer)
  }

  failure(error: unknown): CamundaFailure | undefined {
    return error instanceof FailedRequest ? error.failure : undefined
  }

  bodiesOf(route: string): unknown[] {
    return this.requests
      .filter((request) => request.route === route)
      .map((request) => JSON.parse(request.body) as unknown)
  }

  private async answer(method: string, target: string, body: string): Promise<unknown> {
    const refused = FakeCamundaRest.pathValueProblem(target)
    if (refused !== undefined) {
      throw new FailedRequest({ kind: "transport", reason: "invalid-request", code: refused })
    }
    const route = `${method} ${decodeURIComponent(target)}`
    this.requests.push({ route, target, body })
    const match = this.routes.find(
      (candidate) => candidate.route === route && (candidate.when?.(body) ?? true),
    )
    if (match === undefined) {
      throw new FailedRequest({
        kind: "answered",
        status: 404,
        title: "Not Found",
        detail: `No endpoint ${route}.`,
        redirect: false,
      })
    }
    this.hit.add(match)
    return FakeCamundaRest.resolved(match.answer, body)
  }

  private static async resolved(answer: unknown, body: string): Promise<unknown> {
    if (typeof answer === "function") {
      return FakeCamundaRest.resolved(await (answer as (body: string) => unknown)(body), body)
    }
    if (answer instanceof FailedAnswer) {
      throw new FailedRequest(answer.failure)
    }
    return answer
  }

  private static pathValueProblem(target: string): string | undefined {
    const segments = target.split("/").slice(1)
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return "dot-segment"
    }
    return segments.includes("") ? "empty-segment" : undefined
  }

  private static json(answer: unknown): unknown {
    return JSON.parse(JSON.stringify(answer)) as unknown
  }
}

export function clientWith(routes: readonly RestRoute[]): {
  readonly camunda: FakeCamundaRest
  readonly client: CamundaClient
} {
  const camunda = new FakeCamundaRest(routes)
  return { camunda, client: new RestCamundaClient(camunda) }
}
