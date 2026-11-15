import { afterEach, describe, expect, it } from "vitest"
import { C7Runtime } from "@miragon/pulse-c7-core/runtime"
import { DefinitionId, RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import { FAILURE_REASONS, HttpFailure, type FailureReason } from "@miragon/pulse-http"
import {
  clientFor,
  type FakeEngine,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { createEngineConnection } from "../engine/engine-connection.js"
import {
  EngineRequestError,
  type EngineFailureKind,
  failureError,
  toEngineToolError,
} from "../engine/engine-error.js"
import { closedPortUrl } from "../engine/test-support/raw-engine.js"
import { enginePortFor } from "./engine-port.js"
import { runtimeErrorOf } from "./runtime-errors.test-support.js"

const CTX = { engineId: "e", unauthorizedHint: () => "Sign in." }

/** A transport failure as the connector words it for the model. */
function worded(reason: FailureReason, more: object = {}): EngineRequestError {
  const failure = new HttpFailure(reason, {
    method: "GET",
    target: "",
    mayHaveApplied: false,
    ...more,
  })
  return failureError(failure, CTX)
}

function engineError(
  kind: EngineFailureKind,
  details: { httpStatus?: number; cause?: unknown } = {},
) {
  return new EngineRequestError("words", { kind, engineMessage: "x", engineId: "e", ...details })
}

/** Each reason of the transport, worded by engine-error.ts, as the runtime fails. */
const FAILURE_OF_REASON: Readonly<Record<FailureReason, readonly [object, RuntimeFailure]>> = {
  unreachable: [{ code: "ECONNREFUSED" }, "unreachable"],
  dns: [{ code: "ENOTFOUND" }, "unreachable"],
  tls: [{ code: "CERT_HAS_EXPIRED" }, "unreachable"],
  deadline: [{ limit: 30_000 }, "unreachable"],
  cancelled: [{}, "unreachable"],
  connection: [{ code: "UND_ERR_SOCKET" }, "unreachable"],
  "too-large": [{ limit: 1 }, "unexpectedResponse"],
  redirect: [{ status: 302, location: "https://e/login" }, "misconfigured"],
  unauthorized: [{ status: 401 }, "unauthorized"],
  status: [{ status: 500 }, "engineFailure"],
  "invalid-answer": [{ status: 200 }, "unexpectedResponse"],
  "invalid-request": [{ code: "url" }, "misconfigured"],
  "refused-write": [{}, "misconfigured"],
  credential: [{ code: "token-syntax" }, "misconfigured"],
}

describe("runtimeErrorOf: the connector's engine errors as the engine contract's failures", () => {
  it("reads every reason of the transport, keeping the model's words and the error as cause", () => {
    expect(Object.keys(FAILURE_OF_REASON).sort()).toEqual([...FAILURE_REASONS].sort())
    for (const reason of FAILURE_REASONS) {
      const [details, failure] = FAILURE_OF_REASON[reason]
      const error = worded(reason, details)
      const runtimeError = runtimeErrorOf(error)
      expect(runtimeError, reason).toBeInstanceOf(RuntimeError)
      expect(runtimeError.failure, reason).toBe(failure)
      expect(runtimeError.message, reason).toBe(error.message)
      expect(runtimeError.cause, reason).toBe(error)
      expect(runtimeError.hint, reason).toBeUndefined()
    }
  })

  it("reads an engine's error answer by its status, as the C7 adapter does", () => {
    const statuses: readonly (readonly [number, RuntimeFailure])[] = [
      [301, "misconfigured"],
      [399, "misconfigured"],
      [400, "engineFailure"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "misconfigured"],
      [409, "engineFailure"],
      [500, "engineFailure"],
      [503, "engineFailure"],
    ]
    for (const [httpStatus, failure] of statuses) {
      expect(runtimeErrorOf(engineError("http", { httpStatus })).failure, String(httpStatus)).toBe(
        failure,
      )
    }
    expect(runtimeErrorOf(engineError("http")).failure).toBe("unexpectedResponse")
  })

  it("tells a broken connection from an answer that is no JSON only by its cause", () => {
    const invalid = new HttpFailure("invalid-answer", {
      method: "POST",
      target: "",
      mayHaveApplied: false,
    })
    const broken = new HttpFailure("connection", {
      method: "GET",
      target: "",
      mayHaveApplied: false,
    })
    expect(runtimeErrorOf(engineError("connection", { cause: invalid })).failure).toBe(
      "unexpectedResponse",
    )
    expect(runtimeErrorOf(engineError("connection", { cause: broken })).failure).toBe("unreachable")
    expect(runtimeErrorOf(engineError("connection")).failure).toBe("unreachable")
    expect(runtimeErrorOf(engineError("connection", { cause: new Error("x") })).failure).toBe(
      "unreachable",
    )
  })

  it("reads a success the SDK cannot parse as an unexpected response", () => {
    const error = toEngineToolError(
      new SyntaxError("Unexpected token"),
      new Response("<html>", { status: 200 }),
      { ...CTX, intentOf: () => "read" },
      new Request("http://e/engine-rest/history/process-instance", { method: "POST" }),
    )
    expect(error).toMatchObject({ kind: "connection" })
    expect(runtimeErrorOf(error)).toMatchObject({
      failure: "unexpectedResponse",
      message: "the answer of engine e is no valid JSON",
    })
  })

  it("reads every other kind without a status", () => {
    const kinds: readonly (readonly [EngineFailureKind, RuntimeFailure])[] = [
      ["unreachable", "unreachable"],
      ["tls", "unreachable"],
      ["timeout", "unreachable"],
      ["cancelled", "unreachable"],
      ["too-large", "unexpectedResponse"],
      ["refused", "misconfigured"],
    ]
    for (const [kind, failure] of kinds) {
      expect(runtimeErrorOf(engineError(kind)).failure, kind).toBe(failure)
    }
  })

  it("reads any other error as an unexpected response in its own words", () => {
    const routeless = new Error("c7-core asked for getUsers, which the route table does not hold")
    expect(runtimeErrorOf(routeless)).toMatchObject({
      failure: "unexpectedResponse",
      message: routeless.message,
      cause: routeless,
    })
    expect(runtimeErrorOf("gone")).toMatchObject({
      failure: "unexpectedResponse",
      message: "gone",
      cause: "gone",
    })
  })
})

describe("C7Runtime over the connector's port, its failures read by runtimeErrorOf", () => {
  const engines: FakeEngine[] = []
  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.close()))
  })

  async function runtimeWith(...args: Parameters<typeof startFakeEngine>) {
    const engine = await startFakeEngine(...args)
    engines.push(engine)
    return C7Runtime.over(enginePortFor(clientFor(engine)), { failureOf: runtimeErrorOf })
  }

  it("fails a refused read as forbidden, in the words the model reads", async () => {
    const runtime = await runtimeWith({
      "GET /process-definition/order:1:d/xml": {
        status: 403,
        body: { type: "AuthorizationException", message: "no READ permission" },
      },
    })
    await expect(runtime.getDiagramXml(DefinitionId("order:1:d"))).rejects.toMatchObject({
      failure: "forbidden",
      message: "[403 AuthorizationException] no READ permission (engine fake)",
    })
  })

  it("reads a version the engine does not know as none", async () => {
    const runtime = await runtimeWith({
      "GET /process-definition/order:9:d/xml": {
        status: 404,
        body: { type: "InvalidRequestException", message: "No definition order:9:d" },
      },
    })
    expect(await runtime.getDiagramXml(DefinitionId("order:9:d"))).toBeUndefined()
  })

  it("fails a read of an engine that does not listen as unreachable", async () => {
    const client = createEngineConnection(
      { id: "down", baseUrl: await closedPortUrl() },
      { type: "none" },
    )
    const runtime = C7Runtime.over(enginePortFor(client), { failureOf: runtimeErrorOf })
    await expect(runtime.getDiagramXml(DefinitionId("order:1:d"))).rejects.toMatchObject({
      failure: "unreachable",
      message: "engine down unreachable (ECONNREFUSED)",
    })
  })
})
