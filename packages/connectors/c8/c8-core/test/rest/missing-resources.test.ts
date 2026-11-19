import { describe, expect, test } from "vitest"
import type { CamundaFailure } from "../../src/port/camunda-failure.js"
import { MissingResources } from "../../src/rest/missing-resources.js"

function answered(status: number, title: string | undefined): CamundaFailure {
  return { kind: "answered", status, title, detail: "Nothing has this key.", redirect: false }
}

function unsent(reason: "invalid-request" | "unreachable", code?: string): CamundaFailure {
  return { kind: "transport", reason, code }
}

const TOKEN: CamundaFailure = {
  kind: "token",
  trouble: "client",
  status: 401,
  code: "invalid_client",
  problem: undefined,
  holdMs: 60_000,
  capBytes: undefined,
}

describe("a missing resource, read from the fields of the transport's failure", () => {
  test.each([
    ["a 404 the cluster titles NOT_FOUND", answered(404, "NOT_FOUND")],
    [
      "a dot segment the transport refuses before sending",
      unsent("invalid-request", "dot-segment"),
    ],
    [
      "an empty segment the transport refuses before sending",
      unsent("invalid-request", "empty-segment"),
    ],
  ])("is %s", (_name, failure) => {
    expect(MissingResources.named(failure)).toBe(true)
  })

  test.each([
    ["a 404 of a path the cluster does not know", answered(404, "Not Found")],
    ["a 404 without a title", answered(404, undefined)],
    ["another status titled NOT_FOUND", answered(400, "NOT_FOUND")],
    ["a request the transport cannot send for another reason", unsent("invalid-request")],
    ["a cluster it cannot reach, whatever the code", unsent("unreachable", "dot-segment")],
    ["a token it gets none for", TOKEN],
    ["an error that is no failure of the transport", undefined],
  ])("is not %s", (_name, failure) => {
    expect(MissingResources.named(failure)).toBe(false)
  })
})
