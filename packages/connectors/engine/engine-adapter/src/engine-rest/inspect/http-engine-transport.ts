import type { EngineFailure, EngineTransport, OperationInput } from "@miragon/pulse-c7-core"
import { Present } from "../present.js"
import type { EngineHttp } from "../http/engine-http.js"
import { EngineRequestError } from "../http/engine-request-error.js"
import { InspectOperations } from "./inspect-operations.js"

export interface EngineAnswer {
  readonly json?: unknown
  readonly text?: string
}

const MISSING_AS_ENGINE_HTTP_READS_IT: EngineFailure = {
  status: 404,
  engineType: "EngineRequestError.isMissingResource",
}

export class HttpEngineTransport implements EngineTransport<EngineAnswer> {
  constructor(private readonly http: EngineHttp) {}

  async send(operationId: string, input: OperationInput): Promise<EngineAnswer> {
    const request = InspectOperations.requestOf(operationId, input.pathArgs)
    if (request.text) {
      return { text: await this.http.text(request.path) }
    }
    return { json: await this.http.read(request.path, input.query, input.body) }
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
