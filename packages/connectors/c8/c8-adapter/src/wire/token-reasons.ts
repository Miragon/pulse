import type { AnswerProblem, TokenFailure, TokenFailureKind } from "@miragon/pulse-http/oauth"
import type { TokenAnswerProblem, TokenReason, TokenTrouble } from "./wire-reason.js"

const TROUBLES: Readonly<Record<TokenFailureKind, TokenTrouble>> = {
  client: "client",
  scope: "scope",
  grant: "grant",
  forbidden: "forbidden",
  "rate-limited": "rate-limited",
  unavailable: "unavailable",
  redirect: "redirect",
  "too-large": "too-large",
  unexpected: "unexpected",
  unreachable: "unreachable",
  timeout: "timeout",
  expired: "expired",
}

const PROBLEMS: Readonly<Record<AnswerProblem, TokenAnswerProblem>> = {
  "not-json": "not-json",
  "no-token": "no-token",
  "token-syntax": "token-syntax",
  "token-type": "token-type",
}

export class TokenReasons {
  static of(failure: TokenFailure, tokenEndpoint: string): TokenReason {
    return {
      kind: "token",
      trouble: TROUBLES[failure.kind],
      endpoint: TokenReasons.shown(tokenEndpoint),
      status: failure.status,
      code: failure.code,
      problem: failure.problem === undefined ? undefined : PROBLEMS[failure.problem],
      holdMs: failure.holdMs,
      cause: failure,
    }
  }

  private static shown(url: string): string {
    if (!URL.canParse(url)) {
      return url
    }
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  }
}
