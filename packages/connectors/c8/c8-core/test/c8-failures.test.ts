import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C8Failures, type C8Words, type C8WordsOf } from "../src/c8-failures.js"
import type {
  CamundaFailure,
  CamundaTokenProblem,
  CamundaTokenTrouble,
  CamundaTransportReason,
} from "../src/port/camunda-failure.js"
import { FailedRequest, FakeCamundaRest } from "./support/fake-transport.js"

const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."
const NO_SECONDARY_STORAGE =
  "This cluster runs without secondary storage, so Pulse has nothing to read."
const SECONDARY_STORAGE_HINT =
  "Pulse reads the cluster's search API, which needs secondary storage such as Elasticsearch, OpenSearch or a relational database."

function answered(status: number, title?: string, detail?: string): CamundaFailure {
  return { kind: "answered", status, title, detail, redirect: status >= 300 && status < 400 }
}

function token(trouble: CamundaTokenTrouble, problem?: CamundaTokenProblem): CamundaFailure {
  return {
    kind: "token",
    trouble,
    status: undefined,
    code: undefined,
    problem,
    holdMs: 60_000,
    capBytes: undefined,
  }
}

function failuresWith(words: C8Words) {
  const asked: [unknown, RuntimeFailure][] = []
  const wordsOf: C8WordsOf = (error, kind) => {
    asked.push([error, kind])
    return words
  }
  return { asked, failures: new C8Failures(new FakeCamundaRest([]), wordsOf) }
}

function errorOf(failure: CamundaFailure, words: C8Words = { message: "the surface's words" }) {
  return failuresWith(words).failures.errorOf(new FailedRequest(failure))
}

describe("the kind of a failure the transport copied", () => {
  test.each<[number, RuntimeFailure]>([
    [0, "misconfigured"],
    [302, "misconfigured"],
    [307, "misconfigured"],
    [400, "engineFailure"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "misconfigured"],
    [409, "engineFailure"],
    [429, "engineFailure"],
    [500, "engineFailure"],
    [503, "engineFailure"],
  ])("reads an answer of HTTP %i as %s", (status, kind) => {
    expect(C8Failures.kindOf(answered(status, "Title", "What it states"))).toBe(kind)
  })

  test("reads a 403 that names missing secondary storage as misconfigured, in any case", () => {
    expect(C8Failures.kindOf(answered(403, "Forbidden", "requires Secondary Storage"))).toBe(
      "misconfigured",
    )
    expect(C8Failures.kindOf(answered(403, "Secondary storage", undefined))).toBe("forbidden")
    expect(C8Failures.kindOf(answered(500, "Error", "secondary storage is down"))).toBe(
      "engineFailure",
    )
  })

  test.each<[CamundaTransportReason, RuntimeFailure]>([
    ["unreachable", "unreachable"],
    ["dns", "unreachable"],
    ["tls", "unreachable"],
    ["deadline", "unreachable"],
    ["cancelled", "unreachable"],
    ["connection", "unreachable"],
    ["too-large", "unexpectedResponse"],
    ["redirect", "misconfigured"],
    ["unauthorized", "unauthorized"],
    ["status", "engineFailure"],
    ["invalid-answer", "unexpectedResponse"],
    ["invalid-request", "misconfigured"],
    ["refused-write", "misconfigured"],
    ["credential", "misconfigured"],
  ])("reads the transport's %s as %s", (reason, kind) => {
    expect(C8Failures.kindOf({ kind: "transport", reason, code: undefined })).toBe(kind)
  })

  test.each<[CamundaTokenTrouble, RuntimeFailure]>([
    ["client", "unauthorized"],
    ["scope", "misconfigured"],
    ["grant", "misconfigured"],
    ["forbidden", "forbidden"],
    ["rate-limited", "engineFailure"],
    ["unavailable", "unreachable"],
    ["redirect", "misconfigured"],
    ["too-large", "unexpectedResponse"],
    ["unexpected", "misconfigured"],
    ["unreachable", "unreachable"],
    ["timeout", "unreachable"],
    ["expired", "unauthorized"],
  ])("reads a token's %s as %s", (trouble, kind) => {
    expect(C8Failures.kindOf(token(trouble))).toBe(kind)
  })

  test.each<CamundaTokenProblem>(["not-json", "no-token", "token-syntax", "token-type"])(
    "reads a token answer that is %s as unexpected",
    (problem) => {
      expect(C8Failures.kindOf(token("unexpected", problem))).toBe("unexpectedResponse")
      expect(C8Failures.kindOf(token("client", problem))).toBe("unauthorized")
    },
  )
})

describe("the runtime error of a failure", () => {
  test("asks the surface for its words by the error and the kind, and keeps the error as cause", () => {
    const { asked, failures } = failuresWith({ message: "Cannot reach the cluster", hint: "Look" })
    const error = new FailedRequest({ kind: "transport", reason: "dns", code: "ENOTFOUND" })

    const failure = failures.errorOf(error)

    expect(failure).toBeInstanceOf(RuntimeError)
    expect(failure).toMatchObject({
      failure: "unreachable",
      message: "Cannot reach the cluster",
      hint: "Look",
      cause: error,
    })
    expect(asked).toEqual([[error, "unreachable"]])
  })

  test("passes a runtime error on as it is, asking for no words", () => {
    const { asked, failures } = failuresWith({ message: "unused" })
    const refused = new RuntimeError("unsupported", "refused")

    expect(failures.errorOf(refused)).toBe(refused)
    expect(asked).toEqual([])
  })

  test("reads an error the transport copied nothing of as unexpected, in the surface's words", () => {
    const { asked, failures } = failuresWith({ message: "the cluster answered no JSON" })
    const broken = new Error("broken")

    expect(failures.errorOf(broken)).toMatchObject({
      failure: "unexpectedResponse",
      message: "the cluster answered no JSON",
      hint: undefined,
    })
    expect(asked).toEqual([[broken, "unexpectedResponse"]])
  })

  test("names the REST root for a 404 that names no missing resource, unless the surface has a hint", () => {
    expect(errorOf(answered(404, "Not Found"))).toMatchObject({
      failure: "misconfigured",
      message: "the surface's words",
      hint: ROOT_HINT,
    })
    expect(errorOf(answered(404), { message: "words", hint: "the surface's hint" })).toMatchObject({
      hint: "the surface's hint",
    })
  })

  test("gives no root hint to a missing resource, to another status or to no answer", () => {
    expect(errorOf(answered(404, "NOT_FOUND")).hint).toBeUndefined()
    expect(errorOf(answered(400)).hint).toBeUndefined()
    expect(errorOf({ kind: "transport", reason: "status", code: undefined }).hint).toBeUndefined()
    expect(errorOf(token("client")).hint).toBeUndefined()
  })

  test("says that a cluster without secondary storage has nothing to read, the surface's hint first", () => {
    const failure = answered(403, "Forbidden", "This endpoint requires secondary storage.")

    expect(errorOf(failure)).toMatchObject({
      failure: "misconfigured",
      message: NO_SECONDARY_STORAGE,
      hint: SECONDARY_STORAGE_HINT,
    })
    expect(errorOf(failure, { message: "words", hint: "the surface's hint" })).toMatchObject({
      message: NO_SECONDARY_STORAGE,
      hint: "the surface's hint",
    })
  })

  test("keeps the surface's words for a 403 that names no secondary storage", () => {
    expect(errorOf(answered(403, "Forbidden", "Not yours"))).toMatchObject({
      failure: "forbidden",
      message: "the surface's words",
      hint: undefined,
    })
  })
})
