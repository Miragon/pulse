import {
  BulkOperationId,
  DefinitionId,
  ElementId,
  InstanceId,
  RuntimeError,
  type MigrationPlan,
  type ProcessCommands,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { fakeCommands, fakeRuntime } from "./support/fake-engine.js"
import { engineFailure, REST_URL, type RestRoute } from "./support/fake-engine-rest.js"

const SOURCE = DefinitionId("pulse-order:1:8d0fb34a-cf22-11f1-abf2-ce3814910ef6")
const TARGET = DefinitionId("pulse-order:3:8d1c0f62-cf22-11f1-abf2-ce3814910ef6")
const BATCH = BulkOperationId("aa84e686-cf22-11f1-abf2-ce3814910ef6")
const JOB_DEFINITION = "aa8534a9-cf22-11f1-abf2-ce3814910ef6"
const IDS = [InstanceId("98d32cdf-1"), InstanceId("98d32cdf-2"), InstanceId("98d32cdf-3")]
const REVIEW = ElementId("Activity_ReviewOrder")
const CHARGE = ElementId("Activity_ChargePayment")
const GENERATE = "POST /migration/generate"
const VALIDATE = "POST /migration/validate"
const EXECUTE = "POST /migration/executeAsync"
const RUNNING_QUERY = "POST /history/process-instance"

const PLAN: MigrationPlan = {
  sourceDefinitionId: SOURCE,
  targetDefinitionId: TARGET,
  mappings: [{ sourceElementId: CHARGE, targetElementId: CHARGE }],
}

const BATCH_FIELDS = {
  id: BATCH,
  type: "instance-migration",
  totalJobs: 5,
  invocationsPerBatchJob: 1,
  batchJobDefinitionId: JOB_DEFINITION,
  startTime: "2026-10-23T20:45:22.182+0000",
}

function statistics(answer: unknown): RestRoute {
  return {
    route: "GET /batch/statistics",
    when: (url) => url.searchParams.get("batchId") === BATCH,
    answer,
  }
}

function bodySent(request: { body: string } | undefined): unknown {
  return JSON.parse(request?.body ?? "{}") as unknown
}

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

function historicRow(id: string) {
  return {
    id,
    processDefinitionId: SOURCE,
    processDefinitionKey: "pulse-order",
    processDefinitionVersion: 1,
    state: "ACTIVE",
  }
}

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("proposing a migration", () => {
  test("lets the engine generate the plan, read-only and without changing event triggers", async () => {
    const { runtime, engine } = fakeRuntime([
      {
        route: GENERATE,
        answer: {
          sourceProcessDefinitionId: SOURCE,
          targetProcessDefinitionId: TARGET,
          instructions: [
            {
              sourceActivityIds: ["Activity_ChargePayment"],
              targetActivityIds: ["Activity_ChargePayment"],
              updateEventTrigger: false,
            },
            { sourceActivityIds: ["A", "B"], targetActivityIds: ["C"], updateEventTrigger: false },
          ],
          variables: null,
        },
      },
    ])

    expect(await runtime.proposeMigration(SOURCE, TARGET)).toEqual(PLAN)
    expect(bodySent(engine.requests[0])).toEqual({
      sourceProcessDefinitionId: SOURCE,
      targetProcessDefinitionId: TARGET,
      updateEventTriggers: false,
    })
  })
})

describe("checking a migration", () => {
  test("names the mapping of every failure the engine reports", async () => {
    const { runtime, engine } = fakeRuntime([
      {
        route: VALIDATE,
        answer: {
          instructionReports: [
            {
              instruction: {
                sourceActivityIds: ["Activity_ReviewOrder"],
                targetActivityIds: ["Activity_ChargePayment"],
                updateEventTrigger: false,
              },
              failures: [
                "Activities have incompatible types (UserTaskActivityBehavior is not compatible with ServiceTaskExpressionActivityBehavior)",
              ],
            },
          ],
          variableReports: {},
        },
      },
    ])
    const plan = { ...PLAN, mappings: [{ sourceElementId: REVIEW, targetElementId: CHARGE }] }

    expect(await runtime.checkMigration(plan)).toEqual({
      problems: [
        {
          mapping: { sourceElementId: REVIEW, targetElementId: CHARGE },
          message:
            "Activities have incompatible types (UserTaskActivityBehavior is not compatible with ServiceTaskExpressionActivityBehavior)",
        },
      ],
    })
    expect(bodySent(engine.requests[0])).toEqual({
      sourceProcessDefinitionId: SOURCE,
      targetProcessDefinitionId: TARGET,
      instructions: [
        {
          sourceActivityIds: ["Activity_ReviewOrder"],
          targetActivityIds: ["Activity_ChargePayment"],
          updateEventTrigger: false,
        },
      ],
    })
  })

  test("has no problems when the engine lists none", async () => {
    const { runtime } = fakeRuntime([
      { route: VALIDATE, answer: { instructionReports: [], variableReports: {} } },
    ])

    expect(await runtime.checkMigration(PLAN)).toEqual({ problems: [] })
  })
})

describe("migrating instances", () => {
  const runningTwo: RestRoute = {
    route: RUNNING_QUERY,
    answer: [historicRow(IDS[0]!), historicRow(IDS[2]!)],
  }
  const accepting: RestRoute = { route: EXECUTE, answer: BATCH_FIELDS }

  test("submits only the instances still running on the source as one batch", async () => {
    const { commands, engine } = fakeCommands([runningTwo, accepting])

    expect(await commands.migrateInstances(PLAN, IDS)).toBe(BATCH)
    expect(bodySent(engine.requests[0])).toMatchObject({
      processDefinitionId: SOURCE,
      processInstanceIds: IDS,
      unfinished: true,
    })
    expect(engine.requests[0]?.query).toMatchObject({ maxResults: "3" })
    expect(bodySent(engine.requests[1])).toEqual({
      migrationPlan: {
        sourceProcessDefinitionId: SOURCE,
        targetProcessDefinitionId: TARGET,
        instructions: [
          {
            sourceActivityIds: ["Activity_ChargePayment"],
            targetActivityIds: ["Activity_ChargePayment"],
            updateEventTrigger: false,
          },
        ],
      },
      processInstanceIds: [IDS[0], IDS[2]],
      skipCustomListeners: false,
      skipIoMappings: false,
    })
  })

  test("is rejected without a batch when none of the instances runs on the source", async () => {
    const { commands, engine } = fakeCommands([{ route: RUNNING_QUERY, answer: [] }])

    expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe("rejected")
    expect(engine.requests).toHaveLength(1)
  })

  test("says nothing was submitted when it could not check which instances still run", async () => {
    const { commands, sent } = unreachableCommands()

    const error = await commands.migrateInstances(PLAN, IDS).then(
      () => undefined,
      (caught: unknown) => caught as RuntimeError,
    )

    expect(error).toMatchObject({ failure: "rejected" })
    expect(error?.message).toContain("so it submitted nothing")
    expect(sent).toEqual([RUNNING_QUERY])
  })

  test("keeps a refused login of the check as it is", async () => {
    const { commands } = fakeCommands([
      { route: RUNNING_QUERY, answer: engineFailure(401, "AuthenticationException", "no") },
    ])

    expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe("unauthorized")
  })

  test.each([
    [400, "InvalidRequestException", "rejected"],
    [500, "ProcessEngineException", "engineFailure"],
  ])(
    "leaves the outcome open only when the engine failed with status %i",
    async (status, type, kind) => {
      const { commands } = fakeCommands([
        runningTwo,
        { route: EXECUTE, answer: engineFailure(status, type, "no") },
      ])

      expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe(kind)
    },
  )
})

describe("a migration batch", () => {
  test("reads as a migration", async () => {
    const { runtime } = fakeRuntime([
      statistics([{ ...BATCH_FIELDS, suspended: false, completedJobs: 1, failedJobs: 4 }]),
    ])

    expect(await runtime.getBulkOperation(BATCH)).toMatchObject({
      kind: "migrateInstances",
      state: "running",
      total: 5,
      completed: 1,
      failed: 4,
    })
  })

  test("names the failed instances and why, on one line and cut to 300 characters", async () => {
    const long = `ENGINE-23003 Process instance 'nope-9' cannot be migrated. ${"x".repeat(400)}`
    const { runtime, engine } = fakeRuntime([
      statistics([{ ...BATCH_FIELDS, suspended: false, completedJobs: 1, failedJobs: 3 }]),
      {
        route: "GET /job",
        answer: [
          {
            id: "job-1",
            exceptionMessage:
              "ENGINE-23004 Cannot migrate process instance '98d32cdf-1':\n\tCannot migrate activity instance 'Activity_ReviewOrder:98d353f6':\n\t\tThere is no migration instruction for this instance's activity\n",
          },
          { id: "job-2", exceptionMessage: long },
          { id: "job-3" },
        ],
      },
    ])

    const failures = await runtime.getBulkFailures(BATCH)

    expect(failures[0]).toEqual({
      instanceId: "98d32cdf-1",
      reason:
        "ENGINE-23004 Cannot migrate process instance '98d32cdf-1': Cannot migrate activity instance 'Activity_ReviewOrder:98d353f6': There is no migration instruction for this instance's activity",
    })
    expect(failures[1]?.instanceId).toBe("nope-9")
    expect(failures[1]?.reason).toHaveLength(300)
    expect(failures[2]).toEqual({ reason: "Job job-3 failed without a message." })
    expect(engine.requests[1]?.route).toBe("GET /job")
    expect(engine.requests[1]?.query).toEqual({
      jobDefinitionId: JOB_DEFINITION,
      withException: "true",
      noRetriesLeft: "true",
      maxResults: "100",
    })
  })

  test("has no failures to read once it left the runtime or when none failed", async () => {
    const ended = fakeRuntime([statistics([])])
    expect(await ended.runtime.getBulkFailures(BATCH)).toEqual([])

    const clean = fakeRuntime([
      statistics([{ ...BATCH_FIELDS, suspended: false, completedJobs: 5, failedJobs: 0 }]),
    ])
    expect(await clean.runtime.getBulkFailures(BATCH)).toEqual([])
  })
})
