export type TokenTrouble =
  | "client"
  | "scope"
  | "grant"
  | "forbidden"
  | "rate-limited"
  | "unavailable"
  | "redirect"
  | "too-large"
  | "unexpected"
  | "unreachable"
  | "timeout"
  | "expired"

export type TokenAnswerProblem = "not-json" | "no-token" | "token-syntax" | "token-type"

export interface TokenReason {
  readonly kind: "token"
  readonly trouble: TokenTrouble
  readonly endpoint: string
  readonly status: number | undefined
  readonly code: string | undefined
  readonly problem: TokenAnswerProblem | undefined
  readonly holdMs: number
  readonly cause: unknown
}

interface UnusableReason {
  readonly kind: "unusable"
  readonly message: string
  readonly cause: unknown
}

interface RefusedReason {
  readonly kind: "refused"
  readonly message: string
  readonly cause: unknown
}

export interface UnansweredReason {
  readonly kind: "unanswered"
  readonly message: string
  readonly hint: string | undefined
  readonly cause: unknown
}

export interface AnsweredReason {
  readonly kind: "answered"
  readonly status: number
  readonly message: string
  readonly title: string | undefined
  readonly hint: string | undefined
  readonly cause: unknown
}

interface UnexpectedReason {
  readonly kind: "unexpected"
  readonly message: string
  readonly cause: unknown
}

export type WireReason =
  | UnusableReason
  | RefusedReason
  | UnansweredReason
  | AnsweredReason
  | UnexpectedReason
  | TokenReason
