import {
  clipText,
  decodeText,
  type HttpAnswer,
  mediaTypeOf,
  parseJson,
  problemOf,
  statusTextOf,
} from "@miragon/pulse-http"
import type { AnsweredReason } from "./wire-reason.js"

type Answer = Pick<HttpAnswer, "status" | "statusText" | "contentType" | "body">

export class AnswerReasons {
  static of(answer: Answer, cause?: unknown): AnsweredReason {
    const { type, message } = problemOf(answer)
    const problem = clipText([type, message].filter(Boolean).join(": "))
    const status = AnswerReasons.statusLine(answer.status, answer.statusText)
    return {
      kind: "answered",
      status: answer.status,
      message: problem === "" ? status : `${status}: ${problem}`,
      title: AnswerReasons.titleOf(answer),
      hint: undefined,
      cause,
    }
  }

  static statusLine(status: number, statusText = ""): string {
    return [`HTTP ${String(status)}`, statusTextOf(status, statusText)].filter(Boolean).join(" ")
  }

  private static titleOf(answer: Answer): string | undefined {
    if (!mediaTypeOf(answer.contentType).includes("json")) {
      return undefined
    }
    try {
      const problem = parseJson(decodeText(answer))
      const title = AnswerReasons.fieldOf(problem, "title")
      return typeof title === "string" ? title : undefined
    } catch {
      return undefined
    }
  }

  private static fieldOf(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)[key]
      : undefined
  }
}
