import { decodeText, type Http, type HttpAnswer, type Intent, joinUrl } from "@miragon/pulse-http"
import { LosslessJson } from "../views/lossless-json.js"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import { EngineRequestError } from "./engine-request-error.js"
import { EngineWire, type EngineWireOptions } from "./engine-wire.js"
import { ErrorAnswers } from "./error-answers.js"
import { HttpFailures } from "./http-failures.js"

export type Query = Readonly<Record<string, string | undefined>>

export type EngineHttpOptions = EngineWireOptions

type Method = "GET" | "POST" | "PUT" | "DELETE"

interface EngineRequest {
  readonly method: Method
  readonly path: string
  readonly query: Query
  readonly intent: Intent
  readonly body?: string
  readonly accept?: string
}

const PAGE_SIZE = 500

export class EngineHttp {
  private readonly wire: Http | EngineRequestError

  constructor(options: EngineHttpOptions) {
    this.wire = EngineWire.of(options)
  }

  async read(path: string, query: Query = {}, body?: unknown): Promise<unknown> {
    if (body === undefined) {
      return this.json({ method: "GET", path, query, intent: "read" })
    }
    return this.json({ method: "POST", path, query, intent: "read", body: JSON.stringify(body) })
  }

  async readAll(path: string, query: Query = {}): Promise<unknown[]> {
    const items: unknown[] = []
    for (;;) {
      const page = await this.read(path, {
        ...query,
        firstResult: String(items.length),
        maxResults: String(PAGE_SIZE),
      })
      if (!Array.isArray(page)) {
        throw new UnexpectedAnswerError(`${path} is not a list`)
      }
      items.push(...(page as unknown[]))
      if (page.length < PAGE_SIZE) {
        return items
      }
    }
  }

  async find(path: string, query: Query = {}): Promise<unknown> {
    try {
      return await this.read(path, query)
    } catch (error: unknown) {
      if (EngineRequestError.isMissingResource(error)) {
        return undefined
      }
      throw error
    }
  }

  text(path: string): Promise<string> {
    return this.answer({ method: "GET", path, query: {}, intent: "read", accept: "text/plain" })
  }

  async write(
    method: Exclude<Method, "GET">,
    path: string,
    body?: string,
    query: Query = {},
  ): Promise<unknown> {
    return this.json({
      method,
      path,
      query,
      intent: "write",
      ...(body === undefined ? {} : { body }),
    })
  }

  private async json(request: EngineRequest): Promise<unknown> {
    const text = await this.answer(request)
    if (text === "") {
      return undefined
    }
    try {
      return LosslessJson.parse(text)
    } catch (error: unknown) {
      throw new UnexpectedAnswerError(`the engine answered no JSON: ${String(error)}`)
    }
  }

  private async answer(request: EngineRequest): Promise<string> {
    const answer = await this.exchange(request)
    if (answer.status >= 400) {
      throw ErrorAnswers.errorOf(answer)
    }
    return decodeText(answer)
  }

  private async exchange(request: EngineRequest): Promise<HttpAnswer> {
    const wire = this.wire
    if (wire instanceof EngineRequestError) {
      throw wire
    }
    try {
      return await wire.send({
        method: request.method,
        url: joinUrl(wire.root, request.path, request.query),
        intent: request.intent,
        headers: EngineHttp.headersOf(request),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
    } catch (error: unknown) {
      throw HttpFailures.errorOf(error)
    }
  }

  private static headersOf(request: EngineRequest): Record<string, string> {
    return {
      Accept: request.accept ?? "application/json",
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    }
  }
}
