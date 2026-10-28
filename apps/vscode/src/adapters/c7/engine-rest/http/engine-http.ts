import { Present } from "../present.js"
import { JsonObject } from "../views/json-object.js"
import { LosslessJson } from "../views/lossless-json.js"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import { EngineRequestError } from "./engine-request-error.js"

type EngineCredentials =
  | { readonly kind: "none" }
  | { readonly kind: "basic"; readonly username: string; readonly password: string }

export type Query = Readonly<Record<string, string | undefined>>

export interface EngineHttpOptions {
  readonly url: string
  readonly credentials: EngineCredentials
  readonly writes: boolean
  readonly send: typeof fetch
}

type Method = "GET" | "POST" | "PUT" | "DELETE"

interface EngineRequest {
  readonly method: Method
  readonly path: string
  readonly query: Query
  readonly body?: string
  readonly accept?: string
}

const TIMEOUT_MS = 60_000
const MAX_ANSWER_BYTES = 64 * 1024 * 1024
const PAGE_SIZE = 500

export class EngineHttp {
  constructor(private readonly options: EngineHttpOptions) {}

  async read(path: string, query: Query = {}, body?: unknown): Promise<unknown> {
    if (body === undefined) {
      return this.json({ method: "GET", path, query })
    }
    return this.json({ method: "POST", path, query, body: JSON.stringify(body) })
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
    return this.answer({ method: "GET", path, query: {}, accept: "text/plain" })
  }

  async write(
    method: Exclude<Method, "GET">,
    path: string,
    body?: string,
    query: Query = {},
  ): Promise<unknown> {
    if (!this.options.writes) {
      throw EngineRequestError.refused(`${method} ${path} writes, and this connection only reads`)
    }
    return this.json({ method, path, query, ...(body === undefined ? {} : { body }) })
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
    const url = this.urlOf(request)
    const [response, text] = await this.exchange(url, request)
    if (!response.ok) {
      throw EngineHttp.failureOf(response, text)
    }
    return text
  }

  private async exchange(url: URL, request: EngineRequest): Promise<[Response, string]> {
    try {
      const response = await this.options.send(url, {
        method: request.method,
        headers: this.headersOf(request),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
      return [response, await EngineHttp.cappedTextOf(response)]
    } catch (error: unknown) {
      throw error instanceof UnexpectedAnswerError ? error : EngineHttp.unanswered(error, url)
    }
  }

  private urlOf(request: EngineRequest): URL {
    const url = new URL(`${this.options.url.replace(/\/+$/, "")}${request.path}`)
    for (const [name, value] of Object.entries(request.query)) {
      if (value !== undefined) {
        url.searchParams.set(name, value)
      }
    }
    return url
  }

  private headersOf(request: EngineRequest): Record<string, string> {
    return {
      Accept: request.accept ?? "application/json",
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...this.authorization(),
    }
  }

  private authorization(): Record<string, string> {
    const credentials = this.options.credentials
    if (credentials.kind === "none") {
      return {}
    }
    const pair = new TextEncoder().encode(`${credentials.username}:${credentials.password}`)
    const binary = Array.from(pair, (byte) => String.fromCharCode(byte)).join("")
    return { Authorization: `Basic ${btoa(binary)}` }
  }

  private static async cappedTextOf(response: Response): Promise<string> {
    if (Number(response.headers.get("Content-Length") ?? 0) > MAX_ANSWER_BYTES) {
      void response.body?.cancel().catch(() => undefined)
      throw EngineHttp.tooLarge()
    }
    return response.body === null ? "" : EngineHttp.cappedTextOfStream(response.body.getReader())
  }

  private static async cappedTextOfStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<string> {
    const decoder = new TextDecoder()
    let text = ""
    let total = 0
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      total += read.value.byteLength
      if (total > MAX_ANSWER_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw EngineHttp.tooLarge()
      }
      text += decoder.decode(read.value, { stream: true })
    }
    return text + decoder.decode()
  }

  private static tooLarge(): UnexpectedAnswerError {
    return new UnexpectedAnswerError(`the engine answered with more than ${MAX_ANSWER_BYTES} bytes`)
  }

  private static unanswered(error: unknown, url: URL): EngineRequestError {
    const where = `${url.origin}${url.pathname}`
    if (error instanceof Error && error.name === "TimeoutError") {
      return EngineRequestError.unanswered(`${where} did not answer within ${TIMEOUT_MS} ms`)
    }
    const cause =
      error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined
    const reason = typeof cause?.code === "string" ? cause.code : String(error)
    return EngineRequestError.unanswered(`Cannot reach ${where} (${reason})`)
  }

  private static failureOf(response: Response, text: string): EngineRequestError {
    const reported = EngineHttp.reportedErrorOf(text)
    const status = [`HTTP ${response.status}`, response.statusText].filter(Boolean).join(" ")
    return EngineRequestError.answered(
      response.status,
      reported.message === undefined ? status : `${status}: ${reported.message}`,
      reported.type,
    )
  }

  private static reportedErrorOf(text: string): { message?: string; type?: string } {
    try {
      const reported = JsonObject.of(JSON.parse(text), "engine error")
      return Present.fields({
        message: reported.optionalString("message"),
        type: reported.optionalString("type"),
      })
    } catch {
      return {}
    }
  }
}
