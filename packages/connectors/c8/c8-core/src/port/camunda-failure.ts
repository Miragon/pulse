export type CamundaTransportReason =
  | "unreachable"
  | "dns"
  | "tls"
  | "deadline"
  | "cancelled"
  | "connection"
  | "too-large"
  | "redirect"
  | "unauthorized"
  | "status"
  | "invalid-answer"
  | "invalid-request"
  | "refused-write"
  | "credential"

export type CamundaTokenTrouble =
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

export type CamundaTokenProblem = "not-json" | "no-token" | "token-syntax" | "token-type"

export interface CamundaAnsweredFailure {
  readonly kind: "answered"
  readonly status: number
  readonly title: string | undefined
  readonly detail: string | undefined
  readonly redirect: boolean
}

export interface CamundaTransportFailure {
  readonly kind: "transport"
  readonly reason: CamundaTransportReason
  readonly code: string | undefined
}

export interface CamundaTokenFailure {
  readonly kind: "token"
  readonly trouble: CamundaTokenTrouble
  readonly status: number | undefined
  readonly code: string | undefined
  readonly problem: CamundaTokenProblem | undefined
  readonly holdMs: number
  readonly capBytes: number | undefined
}

export type CamundaFailure = CamundaAnsweredFailure | CamundaTransportFailure | CamundaTokenFailure
