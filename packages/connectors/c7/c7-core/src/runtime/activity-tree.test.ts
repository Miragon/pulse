import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { findActivityTree } from "./activity-tree.js"

const INSTANCE = "63d65e9e-cd7f-11f1-86d2-667bc3771e0d"

const TREE = {
  id: INSTANCE,
  activityId: "pulse-order:1:63b7b305",
  childActivityInstances: [
    {
      id: "SubProcess_Check:1",
      activityId: "SubProcess_Check",
      childActivityInstances: [
        {
          id: "Activity_ReviewOrder:2",
          activityId: "Activity_ReviewOrder",
          childActivityInstances: [],
          childTransitionInstances: [],
        },
      ],
      childTransitionInstances: [{ id: "t1", activityId: "Activity_ChargePayment" }],
    },
  ],
  childTransitionInstances: [],
}

function answering(answer: unknown) {
  return fakePort({ getActivityInstanceTree: () => answer })
}

function failingWith(error: Error) {
  return fakePort({
    getActivityInstanceTree: () => {
      throw error
    },
  })
}

async function unexpectedOf(answer: unknown): Promise<string> {
  const error: unknown = await findActivityTree(answering(answer), INSTANCE).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(RuntimeError.is(error) && error.failure).toBe("unexpectedResponse")
  return error instanceof Error ? error.message : ""
}

describe("findActivityTree", () => {
  it("reads every scope with its activity, the scopes below it and its transition instances", async () => {
    const port = answering(TREE)

    expect(await findActivityTree(port, INSTANCE)).toStrictEqual(TREE)
    expect(port.calls).toStrictEqual([
      { operationId: "getActivityInstanceTree", input: { pathArgs: [INSTANCE], query: {} } },
    ])
  })

  it.each([
    ["absent", {}],
    ["null", { childActivityInstances: null, childTransitionInstances: null }],
  ])("reads the child lists of a scope as none when they are %s", async (_name, children) => {
    const tree = await findActivityTree(
      answering({ id: "root", activityId: "p", ...children }),
      INSTANCE,
    )

    expect(tree).toStrictEqual({
      id: "root",
      activityId: "p",
      childActivityInstances: [],
      childTransitionInstances: [],
    })
  })

  it.each(["a,b", "", "../x", "id?x=1"])(
    "finds no tree of %j, an id no engine assigns, without a request",
    async (instanceId) => {
      const port = answering(TREE)

      expect(await findActivityTree(port, instanceId)).toBeUndefined()
      expect(port.calls).toEqual([])
    },
  )

  it.each([
    ["missing", fakeFailure(404, "InvalidRequestException")],
    ["ended meanwhile", fakeFailure(500, "NullValueException")],
  ])("finds no tree of an instance that is %s", async (_kind, failure) => {
    expect(await findActivityTree(failingWith(failure), INSTANCE)).toBeUndefined()
  })

  it.each([
    ["a wrong REST root", fakeFailure(404, "NotFoundException")],
    ["an engine failure", fakeFailure(500, "ProcessEngineException")],
    ["no engine answer at all", new Error("connection refused")],
  ])("rejects %s as it is", async (_kind, failure) => {
    await expect(findActivityTree(failingWith(failure), INSTANCE)).rejects.toBe(failure)
  })

  it.each([
    ["no answer", undefined, "activity instance is not an object"],
    ["a list", [TREE], "activity instance is not an object"],
    ["a scope without its id", { activityId: "p" }, "id is missing"],
    ["a scope without its activity", { id: "root" }, "activityId is missing"],
    [
      "child scopes that are no list",
      { id: "root", activityId: "p", childActivityInstances: {} },
      "childActivityInstances is not a list",
    ],
    [
      "a child scope that is no object",
      { id: "root", activityId: "p", childActivityInstances: ["a1"] },
      "childActivityInstances[0] is not an object",
    ],
    [
      "a child scope without its activity",
      { id: "root", activityId: "p", childActivityInstances: [{ id: "a1" }] },
      "activityId is missing",
    ],
    [
      "transition instances that are no list",
      { id: "root", activityId: "p", childTransitionInstances: "t1" },
      "childTransitionInstances is not a list",
    ],
    [
      "a transition instance without its id",
      { id: "root", activityId: "p", childTransitionInstances: [{ activityId: "a" }] },
      "id is missing",
    ],
    [
      "a transition instance without its activity",
      { id: "root", activityId: "p", childTransitionInstances: [{ id: "t1" }] },
      "activityId is missing",
    ],
  ])("fails %s as an unexpected answer that says what was wrong", async (_name, answer, words) => {
    expect(await unexpectedOf(answer)).toBe(words)
  })
})
