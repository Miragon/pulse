import type { RequestAuth } from "../auth/request-auth.js"
import { CamundaRequestError } from "./camunda-request-error.js"
import { CappedText } from "./capped-text.js"
import { JsonObject } from "./json-object.js"
import { UnexpectedAnswerError } from "./unexpected-answer-error.js"

export interface CamundaHttpOptions {
  readonly url: string
  readonly auth: RequestAuth
  readonly send: typeof fetch
}

interface CamundaRequest {
  readonly method: "GET" | "POST"
  readonly path: string
  readonly accept: string
  readonly body?: string
}

const TIMEOUT_MS = 60_000
const MAX_ANSWER_BYTES = 64 * 1024 * 1024
const ANSWER_TEXT = new CappedText(MAX_ANSWER_BYTES)
const UNKNOWN_REASON = "unknown failure"

export class CamundaHttp {
  constructor(private readonly options: CamundaHttpOptions) {}

  async get(path: string): Promise<unknown> {
    return CamundaHttp.jsonOf(
      await this.answer({ method: "GET", path, accept: "application/json" }),
    )
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return CamundaHttp.jsonOf(
      await this.answer({
        method: "POST",
        path,
        accept: "application/json",
        body: JSON.stringify(body),
      }),
    )
  }

  text(path: string): Promise<string> {
    return this.answer({ method: "GET", path, accept: "text/xml, application/json" })
  }

  private async answer(request: CamundaRequest): Promise<string> {
    const url = `${CamundaHttp.withoutTrailingSlashes(this.options.url)}${request.path}`
    const authorization = await this.options.auth.header()
    const first = await this.exchange(url, request, authorization)
    const retries =
      first.response.status === 401 &&
      authorization !== undefined &&
      this.options.auth.rejected(authorization)
    const final = retries
      ? await this.exchange(url, request, await this.options.auth.header())
      : first
    if (!final.response.ok) {
      throw CamundaHttp.failureOf(final.response, final.text)
    }
    return final.text
  }

  private async exchange(
    url: string,
    request: CamundaRequest,
    authorization: string | undefined,
  ): Promise<{ readonly response: Response; readonly text: string }> {
    try {
      const response = await this.options.send(url, {
        method: request.method,
        headers: {
          Accept: request.accept,
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(authorization === undefined ? {} : { Authorization: authorization }),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
      return { response, text: await CamundaHttp.cappedTextOf(response) }
    } catch (error: unknown) {
      throw error instanceof UnexpectedAnswerError ? error : CamundaHttp.unanswered(error, url)
    }
  }

  private static jsonOf(text: string): unknown {
    try {
      return JSON.parse(text) as unknown
    } catch (error: unknown) {
      throw new UnexpectedAnswerError(`the cluster answered no JSON: ${String(error)}`)
    }
  }

  private static async cappedTextOf(response: Response): Promise<string> {
    const text = await ANSWER_TEXT.read(response)
    if (text === undefined) {
      throw new UnexpectedAnswerError(
        `the cluster answered with more than ${String(MAX_ANSWER_BYTES)} bytes`,
      )
    }
    return text
  }

  private static withoutTrailingSlashes(url: string): string {
    let end = url.length
    while (end > 0 && url[end - 1] === "/") {
      end -= 1
    }
    return url.slice(0, end)
  }

  private static unanswered(error: unknown, url: string): CamundaRequestError {
    if (error instanceof Error && error.name === "TimeoutError") {
      return CamundaRequestError.unanswered(`${url} did not answer within ${String(TIMEOUT_MS)} ms`)
    }
    return CamundaRequestError.unanswered(`Cannot reach ${url} (${CamundaHttp.reasonOf(error)})`)
  }

  private static reasonOf(error: unknown): string {
    if (!(error instanceof Error)) {
      return UNKNOWN_REASON
    }
    const cause = error.cause as { code?: unknown } | undefined
    return typeof cause?.code === "string" ? cause.code : error.name
  }

  private static failureOf(response: Response, text: string): CamundaRequestError {
    const problem = CamundaHttp.problemOf(text)
    const status = `HTTP ${String(response.status)}`
    return CamundaRequestError.answered(
      response.status,
      problem.detail === undefined ? status : `${status}: ${problem.detail}`,
      problem.title,
    )
  }

  private static problemOf(text: string): { detail?: string; title?: string } {
    try {
      const problem = JsonObject.of(JSON.parse(text), "problem")
      const detail = problem.optionalString("detail")
      const title = problem.optionalString("title")
      return {
        ...(detail === undefined ? {} : { detail }),
        ...(title === undefined ? {} : { title }),
      }
    } catch {
      return {}
    }
  }
}
