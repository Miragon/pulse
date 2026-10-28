import { describe, expect, it } from "vitest"
import { EXIT_CODES, type ErrorCode, PulseCliError, usageError } from "./errors.js"

/** Exit codes as documented in docs/cli/output-and-errors.md. */
const DOCUMENTED: Readonly<Record<ErrorCode, number>> = {
  INTERNAL: 1,
  USAGE: 2,
  READ_ONLY: 2,
  CONFIRMATION_REQUIRED: 2,
  VALIDATION: 2,
  CONFIG: 3,
  HTTP_REDIRECT: 3,
  UNAUTHORIZED: 4,
  FORBIDDEN: 4,
  LOGIN_FAILED: 4,
  TOKEN_EXPIRED: 4,
  NOT_FOUND: 5,
  HTTP_CLIENT_ERROR: 6,
  HTTP_SERVER_ERROR: 7,
  NETWORK: 8,
  TIMEOUT: 8,
  WAIT_TIMEOUT: 9,
  INCIDENT: 9,
  INSTANCE_ENDED: 9,
  JOB_FAILED: 9,
  CHECK_FAILED: 9,
}

describe("EXIT_CODES", () => {
  it("matches the documented exit codes", () => {
    expect(EXIT_CODES).toEqual({
      ok: 0,
      internal: 1,
      usage: 2,
      config: 3,
      auth: 4,
      notFound: 5,
      client: 6,
      server: 7,
      network: 8,
      outcome: 9,
    })
  })
})

describe("PulseCliError", () => {
  it.each(Object.entries(DOCUMENTED))("maps %s to exit code %i", (code, exitCode) => {
    expect(new PulseCliError(code as ErrorCode, "x").exitCode).toBe(exitCode)
  })

  it("keeps code, message, details and cause", () => {
    const cause = new Error("root")
    const error = new PulseCliError("NOT_FOUND", "missing", { status: 404, hint: "h" }, cause)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("PulseCliError")
    expect(error.code).toBe("NOT_FOUND")
    expect(error.message).toBe("missing")
    expect(error.details).toEqual({ status: 404, hint: "h" })
    expect(error.cause).toBe(cause)
  })

  it("has empty details and no cause by default", () => {
    const error = new PulseCliError("INTERNAL", "boom")
    expect(error.details).toEqual({})
    expect("cause" in error).toBe(false)
  })
})

describe("usageError", () => {
  it("creates a USAGE error with an optional hint", () => {
    const withHint = usageError("bad", "try this")
    expect(withHint.code).toBe("USAGE")
    expect(withHint.exitCode).toBe(2)
    expect(withHint.message).toBe("bad")
    expect(withHint.details).toEqual({ hint: "try this" })
    expect(usageError("bad").details).toEqual({})
  })
})
