import {
  BulkOperationId,
  InstanceId,
  RuntimeError,
  type ProcessCommands,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { fakeCommands, fakeRuntime } from "./support/fake-engine.js"
import { engineFailure, REST_URL, type RestRoute } from "./support/fake-engine-rest.js"

const BATCH = BulkOperationId("c7736a0b-cf02-11f1-b08e-3a9a38134a51")
const IDS = [InstanceId("c227efee-1"), InstanceId("c227efee-2"), InstanceId("c227efee-3")]
const STATISTICS = "GET /batch/statistics"
const HISTORIC = `GET /history/batch/${BATCH}`
const SUSPEND = `PUT /batch/${BATCH}/suspended`
const DELETE = `DELETE /batch/${BATCH}`
const NO_CONTENT = new Response(null, { status: 204 })

const BATCH_FIELDS = {
  id: BATCH,
  type: "instance-deletion",
  totalJobs: 3,
  invocationsPerBatchJob: 1,
  startTime: "2026-10-23T16:57:06.830+0000",
}

function statistics(answer: unknown): RestRoute {
  return {
    route: STATISTICS,
    when: (url) => url.searchParams.get("batchId") === BATCH,
    answer,
  }
}

function runningBatch(fields: Record<string, unknown>): RestRoute {
  return statistics([
    { ...BATCH_FIELDS, suspended: false, completedJobs: 0, failedJobs: 0, ...fields },
  ])
}

function deleting(answer: unknown): RestRoute {
  return { route: DELETE, when: (url) => url.searchParams.get("cascade") === "false", answer }
}

const NOT_FOUND = engineFailure(404, "InvalidRequestException", "Historic batch does not exist")
const REFUSED = engineFailure(400, "InvalidRequestException", "Unable to suspend batch")

function unreachableCommands(): { commands: ProcessCommands; sent: string[] } {
  const sent: string[] = []
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  })
  const send: typeof fetch = (input, init) => {
    const request = new Request(input, init)
    sent.push(
      `${request.method} ${new URL(request.url).pathname.replace(new URL(REST_URL).pathname, "")}`,
    )
    return Promise.reject(refused)
  }
  const connection = { endpoint: REST_URL, credentials: { kind: "none" } } as const
  return { commands: new C7Adapter(send).commands(connection), sent }
}

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("cancelling instances", () => {
  const accepting: RestRoute = { route: "POST /process-instance/delete", answer: BATCH_FIELDS }

  test("sends the ids and the reason in the body of exactly this request", async () => {
    const { commands, engine } = fakeCommands([accepting])

    const id = await commands.cancelInstances(IDS, { reason: "test data" })

    expect(id).toBe(BATCH)
    expect(engine.requests.map((request) => request.route)).toEqual([
      "POST /process-instance/delete",
    ])
    expect(JSON.parse(engine.requests[0]?.body ?? "{}") as unknown).toEqual({
      processInstanceIds: IDS,
      deleteReason: "test data",
      skipCustomListeners: false,
      skipSubprocesses: false,
      skipIoMappings: false,
    })
  })

  test("sends no delete reason when there is none", async () => {
    const { commands, engine } = fakeCommands([accepting])

    await commands.cancelInstances(IDS)

    expect(JSON.parse(engine.requests[0]?.body ?? "{}") as unknown).not.toHaveProperty(
      "deleteReason",
    )
  })

  test("keeps the reason out of an engine error, which leaves the outcome open", async () => {
    const { commands } = fakeCommands([
      {
        route: "POST /process-instance/delete",
        answer: engineFailure(
          500,
          "ProcessEngineException",
          'Cannot delete: reason "cleanup \\"ticket\\" 42"',
        ),
      },
    ])

    const error = await commands.cancelInstances(IDS, { reason: 'cleanup "ticket" 42' }).then(
      () => undefined,
      (caught: unknown) => caught as RuntimeError,
    )

    expect(error).toMatchObject({ failure: "engineFailure" })
    expect(error?.message).not.toContain("ticket")
  })
})

describe("reading a bulk operation", () => {
  test("reads a running batch from its statistics, counting items, not jobs", async () => {
    const { runtime } = fakeRuntime([
      runningBatch({
        invocationsPerBatchJob: 2,
        totalJobs: 2,
        completedJobs: 1,
        failedJobs: 1,
      }),
    ])

    expect(await runtime.getBulkOperation(BATCH)).toEqual({
      id: BATCH,
      kind: "cancelInstances",
      state: "running",
      total: 4,
      completed: 2,
      failed: 2,
      startedAt: "2026-10-23T16:57:06.830Z",
    })
  })

  test("reads a suspended batch as suspended", async () => {
    const { runtime } = fakeRuntime([runningBatch({ suspended: true })])

    expect(await runtime.getBulkOperation(BATCH)).toMatchObject({ state: "suspended" })
  })

  test("reads a batch that left the runtime from its history, without counts", async () => {
    const { runtime } = fakeRuntime([
      statistics([]),
      {
        route: HISTORIC,
        answer: { ...BATCH_FIELDS, endTime: "2026-10-23T16:57:06.894+0000" },
      },
    ])

    expect(await runtime.getBulkOperation(BATCH)).toEqual({
      id: BATCH,
      kind: "cancelInstances",
      state: "ended",
      total: 3,
      startedAt: "2026-10-23T16:57:06.830Z",
      endedAt: "2026-10-23T16:57:06.894Z",
    })
  })

  test("knows no batch that is neither running nor in the history", async () => {
    const { runtime } = fakeRuntime([statistics([]), { route: HISTORIC, answer: NOT_FOUND }])

    expect(await runtime.getBulkOperation(BATCH)).toBeUndefined()
  })

  test("knows no batch of another type", async () => {
    const { runtime } = fakeRuntime([runningBatch({ type: "set-job-retries" })])

    expect(await runtime.getBulkOperation(BATCH)).toBeUndefined()
  })
})

describe("stopping a bulk operation", () => {
  test("suspends the batch, then deletes it without its history", async () => {
    const { commands, engine } = fakeCommands([
      { route: SUSPEND, answer: NO_CONTENT },
      deleting(NO_CONTENT),
    ])

    await commands.stopBulkOperation(BATCH)

    expect(engine.requests.map((request) => [request.route, request.body, request.query])).toEqual([
      [SUSPEND, '{"suspended":true}', {}],
      [DELETE, "", { cascade: "false" }],
    ])
  })

  test("counts a batch that stays suspended because a running job blocks the delete as stopped", async () => {
    const { commands } = fakeCommands([
      { route: SUSPEND, answer: NO_CONTENT },
      deleting(engineFailure(500, "ProcessEngineException", "updated concurrently")),
      runningBatch({ suspended: true }),
    ])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("succeeded")
  })

  test("resolves for a batch that already ended", async () => {
    const { commands } = fakeCommands([
      { route: SUSPEND, answer: REFUSED },
      deleting(REFUSED),
      statistics([]),
      { route: HISTORIC, answer: BATCH_FIELDS },
    ])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("succeeded")
  })

  test("is rejected for a batch the engine does not know", async () => {
    const { commands } = fakeCommands([
      { route: SUSPEND, answer: REFUSED },
      statistics([]),
      { route: HISTORIC, answer: NOT_FOUND },
    ])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("rejected")
  })

  test("fails when the batch still runs after a refused suspend", async () => {
    const { commands } = fakeCommands([{ route: SUSPEND, answer: REFUSED }, runningBatch({})])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("rejected")
  })

  test("asks nothing more after a suspend that failed as unauthorized", async () => {
    const { commands, engine } = fakeCommands([
      { route: SUSPEND, answer: engineFailure(401, "AuthenticationException", "no") },
    ])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("unauthorized")
    expect(engine.requests.map((request) => request.route)).toEqual([SUSPEND])
  })

  test("asks nothing more after a suspend that failed as unreachable", async () => {
    const { commands, sent } = unreachableCommands()

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("unreachable")
    expect(sent).toEqual([SUSPEND])
  })

  test("does not call a batch stopped when its delete was forbidden", async () => {
    const { commands } = fakeCommands([
      { route: SUSPEND, answer: NO_CONTENT },
      deleting(engineFailure(403, "AuthorizationException", "no")),
    ])

    expect(await failureOf(commands.stopBulkOperation(BATCH))).toBe("forbidden")
  })
})

describe("instances by id", () => {
  test("asks for no more rows than there are ids", async () => {
    const { runtime, engine } = fakeRuntime([
      { route: "POST /history/process-instance", answer: [] },
    ])

    await runtime.searchInstances({ instanceIds: IDS }, { limit: 1000 })

    expect(engine.requests[0]?.query).toMatchObject({ maxResults: "3" })
  })

  test("sends the ids in the query body", async () => {
    const { runtime, engine } = fakeRuntime([
      { route: "POST /history/process-instance/count", answer: { count: 3 } },
    ])

    expect(await runtime.countInstances({ instanceIds: IDS })).toBe(3)
    expect(engine.requests.map((request) => request.route)).toEqual([
      "POST /history/process-instance/count",
    ])
    expect(JSON.parse(engine.requests[0]?.body ?? "{}") as unknown).toEqual({
      processInstanceIds: IDS,
    })
  })

  test("finds nothing for an empty list without asking the engine", async () => {
    const { runtime, engine } = fakeRuntime([])

    expect(await runtime.countInstances({ instanceIds: [] })).toBe(0)
    expect(await runtime.searchInstances({ instanceIds: [] }, { limit: 5 })).toEqual({ items: [] })
    expect(engine.requests).toEqual([])
  })
})
