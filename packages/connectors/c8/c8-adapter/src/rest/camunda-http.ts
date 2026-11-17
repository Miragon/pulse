import {
  type CamundaFailure,
  type CamundaTransport,
  UnexpectedAnswerError,
} from "@miragon/pulse-c8-core"
import type { CamundaWire, WireRequest } from "../wire/camunda-wire.js"
import { WireJson } from "../wire/wire-json.js"
import { CamundaRequestError } from "./camunda-request-error.js"

const JSON_TYPE = "application/json"
const XML_TYPES = "text/xml, application/json"

export class CamundaHttp implements CamundaTransport {
  constructor(private readonly wire: CamundaWire) {}

  async get(path: string): Promise<unknown> {
    return CamundaHttp.jsonOf(
      await this.answer({ method: "GET", path, accept: JSON_TYPE, intent: "read" }),
    )
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return CamundaHttp.jsonOf(
      await this.answer({
        method: "POST",
        path,
        accept: JSON_TYPE,
        intent: "read",
        body: JSON.stringify(body),
      }),
    )
  }

  text(path: string): Promise<string> {
    return this.answer({ method: "GET", path, accept: XML_TYPES, intent: "read" })
  }

  failure(error: unknown): CamundaFailure | undefined {
    return error instanceof CamundaRequestError ? error.fields : undefined
  }

  private async answer(request: WireRequest): Promise<string> {
    const outcome = await this.wire.exchange(request)
    if ("reason" in outcome) {
      throw CamundaRequestError.of(outcome.reason)
    }
    return outcome.text
  }

  private static jsonOf(text: string): unknown {
    try {
      return WireJson.parse(text)
    } catch (error: unknown) {
      throw new UnexpectedAnswerError(`the cluster answered no JSON: ${String(error)}`, {
        cause: error,
      })
    }
  }
}
