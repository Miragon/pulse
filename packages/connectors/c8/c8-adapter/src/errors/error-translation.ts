import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import { CamundaRequestError, type CamundaRequestFailure } from "../rest/index.js"
import { TokenTexts } from "./token-texts.js"

const NO_SECONDARY_STORAGE =
  "This cluster runs without secondary storage, so Pulse has nothing to read."
const SECONDARY_STORAGE_HINT =
  "Pulse reads the cluster's search API, which needs secondary storage such as Elasticsearch, OpenSearch or a relational database."
const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."
const MISSING_RESOURCE_TITLE = "NOT_FOUND"

const WITHOUT_STATUS: Readonly<Record<CamundaRequestFailure, RuntimeFailure>> = {
  refused: "misconfigured",
  unusable: "misconfigured",
  unanswered: "unreachable",
  answered: "misconfigured",
  token: "unauthorized",
}

export class ErrorTranslation {
  static async translated<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw ErrorTranslation.runtimeErrorOf(error)
    }
  }

  private static runtimeErrorOf(error: unknown): RuntimeError {
    if (RuntimeError.is(error)) {
      return error
    }
    if (error instanceof CamundaRequestError) {
      return ErrorTranslation.ofRequest(error)
    }
    const message = error instanceof Error ? error.message : String(error)
    return new RuntimeError("unexpectedResponse", message, { cause: error })
  }

  private static ofRequest(error: CamundaRequestError): RuntimeError {
    if (error.token !== undefined) {
      return TokenTexts.errorOf(error.token)
    }
    if (error.needsSecondaryStorage()) {
      return new RuntimeError("misconfigured", NO_SECONDARY_STORAGE, {
        cause: error,
        hint: SECONDARY_STORAGE_HINT,
      })
    }
    const hint = error.hint ?? ErrorTranslation.rootHintOf(error)
    return new RuntimeError(ErrorTranslation.failureOf(error), error.message, {
      cause: error,
      ...(hint === undefined ? {} : { hint }),
    })
  }

  private static failureOf(error: CamundaRequestError): RuntimeFailure {
    const status = error.status
    if (status === undefined) {
      return WITHOUT_STATUS[error.failure]
    }
    if (status === 401 || status === 403) {
      return status === 403 ? "forbidden" : "unauthorized"
    }
    return status < 400 || status === 404 ? "misconfigured" : "engineFailure"
  }

  private static rootHintOf(error: CamundaRequestError): string | undefined {
    return error.status === 404 && error.title !== MISSING_RESOURCE_TITLE ? ROOT_HINT : undefined
  }
}
