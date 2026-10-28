import { ElementId, InstanceId, RuntimeError } from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { fakeCommands } from "./support/fake-engine.js"
import { engineFailure, type RestRoute } from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS } from "./support/fixtures.js"

const REVIEW = InstanceId(WORLD_IDS.review)
const CHARGE = InstanceId(WORLD_IDS.charge)
const REVIEW_ORDER = ElementId("Activity_ReviewOrder")
const CHARGE_PAYMENT = ElementId("Activity_ChargePayment")
const TREE = `GET /process-instance/${REVIEW}/activity-instances`
const MODIFY = `POST /process-instance/${REVIEW}/modification`
const REASON = "Charged by hand after the outage"
const ACCEPTED: RestRoute = { route: MODIFY, answer: new Response(null, { status: 204 }) }

function treeOf(name: string, instanceId: string = REVIEW): RestRoute {
  return {
    route: `GET /process-instance/${instanceId}/activity-instances`,
    answer: new Response(fixture(name)),
  }
}

function treeWith(children: readonly object[], transitions: readonly object[] = []): RestRoute {
  const root = { id: "root", activityId: "pulse-order:1:x" }
  const tree = { ...root, childActivityInstances: children, childTransitionInstances: transitions }
  return { route: TREE, answer: tree }
}

function cancelOf(body: string | undefined): unknown {
  const modification = JSON.parse(body ?? "{}") as { instructions: readonly unknown[] }
  return modification.instructions[1]
}

async function failureOf(attempt: Promise<void>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("moving a token", () => {
  test("starts the target and then cancels exactly the token read from the tree, in one request", async () => {
    const { commands, engine } = fakeCommands([treeOf("activity-instances-review.json"), ACCEPTED])

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: ` ${REASON} `,
    })

    expect(engine.requests.map((request) => request.route)).toEqual([TREE, MODIFY])
    expect(JSON.parse(engine.requests[1]?.body ?? "{}")).toEqual({
      annotation: REASON,
      instructions: [
        { type: "startBeforeActivity", activityId: "Activity_ReviewOrder" },
        {
          type: "cancel",
          activityInstanceId: "Activity_ReviewOrder:63d7bdc3-cd7f-11f1-86d2-667bc3771e0d",
        },
      ],
    })
  })

  test("cancels a token that waits for its job as a transition instance", async () => {
    const { commands, engine } = fakeCommands([
      treeOf("activity-instances-charge.json", CHARGE),
      { route: `POST /process-instance/${CHARGE}/modification`, answer: ACCEPTED.answer },
    ])

    await commands.moveToken(CHARGE, {
      fromElementId: CHARGE_PAYMENT,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    })

    expect(cancelOf(engine.requests[1]?.body)).toEqual({
      type: "cancel",
      transitionInstanceId: "63da7d5d-cd7f-11f1-86d2-667bc3771e0d",
    })
  })

  test("reads the tree read-only and writes without skipping listeners or mappings", async () => {
    const { commands, engine } = fakeCommands([treeOf("activity-instances-review.json"), ACCEPTED])

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    })

    expect(engine.requests[0]?.route).toBe(TREE)
    expect(engine.requests[1]?.route).toBe(MODIFY)
    expect(engine.requests[1]?.query).toEqual({})
    expect(engine.requests[1]?.body).not.toMatch(/skip/i)
  })

  test.each([
    ["no token", treeWith([])],
    [
      "two tokens",
      treeWith([
        { id: "a1", activityId: "Activity_ReviewOrder" },
        { id: "a2", activityId: "Activity_ReviewOrder" },
      ]),
    ],
    [
      "an activity and a transition instance",
      treeWith(
        [{ id: "a1", activityId: "Activity_ReviewOrder" }],
        [{ id: "t1", activityId: "Activity_ReviewOrder" }],
      ),
    ],
    [
      "a multi-instance body",
      treeWith([
        {
          id: "body",
          activityId: "Activity_ReviewOrder#multiInstanceBody",
          childActivityInstances: [{ id: "a1", activityId: "Activity_ReviewOrder" }],
        },
      ]),
    ],
  ])("is rejected before any write when the source holds %s", async (_what, tree) => {
    const { commands, engine } = fakeCommands([tree])

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe("rejected")
    expect(engine.requests.map((request) => request.route)).toEqual([TREE])
  })

  test("finds a single token inside a sub-process", async () => {
    const { commands, engine } = fakeCommands([
      treeWith([
        {
          id: "sub",
          activityId: "SubProcess_Check",
          childActivityInstances: [{ id: "a1", activityId: "Activity_ReviewOrder" }],
        },
      ]),
      ACCEPTED,
    ])

    await commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: REVIEW_ORDER,
      reason: REASON,
    })

    expect(cancelOf(engine.requests[1]?.body)).toEqual({
      type: "cancel",
      activityInstanceId: "a1",
    })
  })

  test.each([
    "",
    "   ",
    "x".repeat(501),
    "two\nlines",
    "bell\u0007",
    "rtl‮override",
    "line separator",
  ])("is rejected before calling the engine for the reason %j", async (reason) => {
    const { commands, engine } = fakeCommands([])

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason,
        }),
      ),
    ).toBe("rejected")
    expect(engine.requests).toEqual([])
  })

  test("is rejected without a write when the instance is not running", async () => {
    const { commands, engine } = fakeCommands([
      {
        route: TREE,
        answer: engineFailure(
          404,
          "InvalidRequestException",
          "Process instance with id 63d65e9e does not exist",
        ),
      },
    ])

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe("rejected")
    expect(engine.requests.map((request) => request.route)).toEqual([TREE])
  })

  test("refuses an instance id that could smuggle more ids into the request", async () => {
    const { commands, engine } = fakeCommands([])

    expect(
      await failureOf(
        commands.moveToken(InstanceId("a,b"), {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe("rejected")
    expect(engine.requests).toEqual([])
  })

  test("keeps element ids out of the request line", async () => {
    const odd = ElementId("Aktivität_Prüfen --yes")
    const { commands, engine } = fakeCommands([treeWith([{ id: "a1", activityId: odd }]), ACCEPTED])

    await commands.moveToken(REVIEW, { fromElementId: odd, toElementId: odd, reason: REASON })

    const requestLines = engine.requests.map(
      (request) => `${request.route} ${Object.values(request.query).join(" ")}`,
    )
    expect(requestLines.join(" ")).not.toContain(odd)
    expect(JSON.parse(engine.requests[1]?.body ?? "{}")).toMatchObject({
      instructions: [{ activityId: odd }, { activityInstanceId: "a1" }],
    })
  })

  test('maps an engine refusal to "rejected" and keeps the reason out of the message', async () => {
    const { commands } = fakeCommands([
      treeOf("activity-instances-review.json"),
      {
        route: MODIFY,
        answer: engineFailure(
          400,
          "InvalidRequestException",
          `Cannot start Unknown_Element: ${REASON}`,
        ),
      },
    ])

    const attempt = commands.moveToken(REVIEW, {
      fromElementId: REVIEW_ORDER,
      toElementId: ElementId("Unknown_Element"),
      reason: REASON,
    })

    await expect(attempt).rejects.toMatchObject({
      failure: "rejected",
      message: "HTTP 400: Cannot start Unknown_Element: ‹value›",
    })
  })

  test("reports a malformed tree as an unexpected response", async () => {
    const { commands } = fakeCommands([{ route: TREE, answer: { id: "root" } }])

    expect(
      await failureOf(
        commands.moveToken(REVIEW, {
          fromElementId: REVIEW_ORDER,
          toElementId: REVIEW_ORDER,
          reason: REASON,
        }),
      ),
    ).toBe("unexpectedResponse")
  })
})
