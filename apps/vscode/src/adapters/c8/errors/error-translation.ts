import { RuntimeError, type RuntimeFailure } from "../../../contract/index.js"
import { CamundaRequestError } from "../rest/index.js"

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
    if (error.needsSecondaryStorage()) {
      return new RuntimeError(
        "misconfigured",
        "This cluster runs without secondary storage, so Pulse has nothing to read.",
        { cause: error },
      )
    }
    const failure = ErrorTranslation.failureOf(error)
    return new RuntimeError(failure, error.message, {
      cause: error,
      ...(failure === "misconfigured"
        ? { hint: "The profile's url must be the REST root of the cluster and end in /v2." }
        : {}),
    })
  }

  private static failureOf(error: CamundaRequestError): RuntimeFailure {
    if (error.failure === "unanswered") {
      return "unreachable"
    }
    const status = error.status ?? 0
    if (status === 401) {
      return "unauthorized"
    }
    if (status === 403) {
      return "forbidden"
    }
    return status < 400 || status === 404 ? "misconfigured" : "engineFailure"
  }
}
