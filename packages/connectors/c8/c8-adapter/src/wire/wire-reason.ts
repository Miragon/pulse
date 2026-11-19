import type { CamundaTokenProblem, CamundaTokenTrouble } from "@miragon/pulse-c8-core"

export interface TokenReason {
  readonly kind: "token"
  readonly trouble: CamundaTokenTrouble
  readonly endpoint: string
  readonly status: number | undefined
  readonly code: string | undefined
  readonly problem: CamundaTokenProblem | undefined
  readonly holdMs: number
  readonly capBytes: number | undefined
  readonly cause: unknown
}

export interface UnreadReason {
  readonly kind: "unread"
  readonly message: string
  readonly hint: string | undefined
  readonly cause: unknown
}

export interface AnsweredReason {
  readonly kind: "answered"
  readonly status: number
  readonly message: string
  readonly title: string | undefined
  readonly detail: string | undefined
  readonly redirect: boolean
  readonly hint: string | undefined
  readonly cause: unknown
}

export type WireReason = UnreadReason | AnsweredReason | TokenReason
