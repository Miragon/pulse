import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import type {
  CamundaAnsweredFailure,
  CamundaFailure,
  CamundaTokenFailure,
  CamundaTokenTrouble,
  CamundaTransportReason,
} from "./port/camunda-failure.js"
import type { CamundaTransport } from "./port/camunda-transport.js"
import { MissingResources } from "./rest/missing-resources.js"

export interface C8Words {
  readonly message: string
  readonly hint?: string | undefined
}

export type C8WordsOf = (error: unknown, kind: RuntimeFailure) => C8Words

const NO_SECONDARY_STORAGE =
  "This cluster runs without secondary storage, so Pulse has nothing to read."
const SECONDARY_STORAGE_HINT =
  "Pulse reads the cluster's search API, which needs secondary storage such as Elasticsearch, OpenSearch or a relational database."
const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."
const SECONDARY_STORAGE = /secondary storage/i

const TRANSPORT_KINDS: Readonly<Record<CamundaTransportReason, RuntimeFailure>> = {
  unreachable: "unreachable",
  dns: "unreachable",
  tls: "unreachable",
  deadline: "unreachable",
  cancelled: "unreachable",
  connection: "unreachable",
  "too-large": "unexpectedResponse",
  redirect: "misconfigured",
  unauthorized: "unauthorized",
  status: "engineFailure",
  "invalid-answer": "unexpectedResponse",
  "invalid-request": "misconfigured",
  "refused-write": "misconfigured",
  credential: "misconfigured",
}

const TOKEN_KINDS: Readonly<Record<CamundaTokenTrouble, RuntimeFailure>> = {
  client: "unauthorized",
  scope: "misconfigured",
  grant: "misconfigured",
  forbidden: "forbidden",
  "rate-limited": "engineFailure",
  unavailable: "unreachable",
  redirect: "misconfigured",
  "too-large": "unexpectedResponse",
  unexpected: "misconfigured",
  unreachable: "unreachable",
  timeout: "unreachable",
  expired: "unauthorized",
}

const ANSWERED_KINDS: Readonly<Record<number, RuntimeFailure>> = {
  401: "unauthorized",
  403: "forbidden",
  404: "misconfigured",
}

export class C8Failures {
  constructor(
    private readonly transport: CamundaTransport,
    private readonly wordsOf: C8WordsOf,
  ) {}

  static kindOf(failure: CamundaFailure): RuntimeFailure {
    switch (failure.kind) {
      case "answered":
        return C8Failures.answeredKind(failure)
      case "transport":
        return TRANSPORT_KINDS[failure.reason]
      case "token":
        return C8Failures.tokenKind(failure)
    }
  }

  errorOf(error: unknown): RuntimeError {
    if (RuntimeError.is(error)) {
      return error
    }
    const failure = this.transport.failure(error)
    const kind = failure === undefined ? "unexpectedResponse" : C8Failures.kindOf(failure)
    const { message, hint } = C8Failures.stated(failure, this.wordsOf(error, kind))
    return new RuntimeError(kind, message, {
      cause: error,
      ...(hint === undefined ? {} : { hint }),
    })
  }

  private static stated(failure: CamundaFailure | undefined, words: C8Words): C8Words {
    if (failure?.kind !== "answered") {
      return words
    }
    if (C8Failures.lacksSecondaryStorage(failure)) {
      return { message: NO_SECONDARY_STORAGE, hint: words.hint ?? SECONDARY_STORAGE_HINT }
    }
    return { message: words.message, hint: words.hint ?? C8Failures.rootHintOf(failure) }
  }

  private static answeredKind(failure: CamundaAnsweredFailure): RuntimeFailure {
    if (C8Failures.lacksSecondaryStorage(failure)) {
      return "misconfigured"
    }
    const kind = ANSWERED_KINDS[failure.status]
    if (kind !== undefined) {
      return kind
    }
    return failure.status < 400 ? "misconfigured" : "engineFailure"
  }

  private static tokenKind(failure: CamundaTokenFailure): RuntimeFailure {
    return failure.trouble === "unexpected" && failure.problem !== undefined
      ? "unexpectedResponse"
      : TOKEN_KINDS[failure.trouble]
  }

  private static lacksSecondaryStorage(failure: CamundaAnsweredFailure): boolean {
    return failure.status === 403 && SECONDARY_STORAGE.test(failure.detail ?? "")
  }

  private static rootHintOf(failure: CamundaAnsweredFailure): string | undefined {
    return failure.status === 404 && !MissingResources.named(failure) ? ROOT_HINT : undefined
  }
}
