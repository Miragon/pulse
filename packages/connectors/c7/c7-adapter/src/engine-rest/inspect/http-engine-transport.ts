import {
  CORE_ROUTES,
  type EngineFailure,
  type EngineTransport,
  type OperationInput,
  type Route,
  routedTransport,
  type RoutedWire,
} from "@miragon/pulse-c7-core"
import { Present } from "../present.js"
import type { EngineHttp } from "../http/engine-http.js"
import { EngineRequestError } from "../http/engine-request-error.js"
import { CoreRequests } from "./core-requests.js"

export interface EngineAnswer {
  readonly json?: unknown
  readonly text?: string
}

const MISSING_AS_ENGINE_HTTP_READS_IT: EngineFailure = {
  status: 404,
  engineType: "EngineRequestError.isMissingResource",
}

export class HttpEngineTransport implements RoutedWire<EngineAnswer> {
  constructor(private readonly http: EngineHttp) {}

  static over(http: EngineHttp): EngineTransport<EngineAnswer> {
    return routedTransport(CORE_ROUTES, new HttpEngineTransport(http))
  }

  async send(route: Route, input: OperationInput): Promise<EngineAnswer> {
    if (route.method !== "GET" || route.effect !== "read") {
      throw new RangeError(
        `The inspection sends reading GETs only, not ${route.operationId} (${route.method}, ${route.effect})`,
      )
    }
    const path = CoreRequests.pathOf(route, input.pathArgs)
    if (CoreRequests.answersText(route)) {
      return { text: await this.http.text(path) }
    }
    return { json: await this.http.read(path, input.query) }
  }

  json(answer: EngineAnswer): unknown {
    return answer.json
  }

  text(answer: EngineAnswer): string | undefined {
    return answer.text
  }

  failure(error: unknown): EngineFailure | undefined {
    if (EngineRequestError.isMissingResource(error)) {
      return MISSING_AS_ENGINE_HTTP_READS_IT
    }
    const status = EngineRequestError.statusOf(error)
    return status === undefined || !(error instanceof EngineRequestError)
      ? undefined
      : { status, ...Present.fields({ engineType: error.engineType }) }
  }
}
