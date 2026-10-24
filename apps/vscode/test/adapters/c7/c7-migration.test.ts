import {
  BulkOperationId,
  DefinitionId,
  ElementId,
  InstanceId,
  RuntimeError,
  type MigrationPlan,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { fakeCommands, fakeRuntime, type FakeRoute } from "./support/fake-engine-cli.js"

const SOURCE = DefinitionId("pulse-order:1:8d0fb34a-cf22-11f1-abf2-ce3814910ef6")
const TARGET = DefinitionId("pulse-order:3:8d1c0f62-cf22-11f1-abf2-ce3814910ef6")
const BATCH = BulkOperationId("aa84e686-cf22-11f1-abf2-ce3814910ef6")
const JOB_DEFINITION = "aa8534a9-cf22-11f1-abf2-ce3814910ef6"
const IDS = [InstanceId("98d32cdf-1"), InstanceId("98d32cdf-2"), InstanceId("98d32cdf-3")]
const REVIEW = ElementId("Activity_ReviewOrder")
const CHARGE = ElementId("Activity_ChargePayment")
const GENERATE = ["migration", "generate-plan", "--body", "-"]
const VALIDATE = ["migration", "validate-plan", "--body", "-"]
const EXECUTE = ["migration", "execute-plan-async", "--yes", "--body", "-"]
const RUNNING_QUERY = ["historic-process-instance", "query"]
const STATISTICS = ["batch", "get-statistics", "--batch-id", BATCH]

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

function failure(exitCode: number, code: string, message: string): Partial<FakeRoute> {
  return { exitCode, stderr: JSON.stringify({ error: { code, exitCode, message } }) }
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
    const { runtime, cli } = fakeRuntime([
      {
        command: GENERATE,
        stdout: JSON.stringify({
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
        }),
      },
    ])

    expect(await runtime.proposeMigration(SOURCE, TARGET)).toEqual(PLAN)
    expect(JSON.parse(cli.invocations[0]?.input ?? "{}")).toEqual({
      sourceProcessDefinitionId: SOURCE,
      targetProcessDefinitionId: TARGET,
      updateEventTriggers: false,
    })
    expect(cli.invocations[0]?.environment).toHaveProperty("OPERATE_READ_ONLY", "1")
  })
})

describe("checking a migration", () => {
  test("names the mapping of every failure the engine reports", async () => {
    const { runtime, cli } = fakeRuntime([
      {
        command: VALIDATE,
        stdout: JSON.stringify({
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
        }),
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
    expect(JSON.parse(cli.invocations[0]?.input ?? "{}")).toEqual({
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
    expect(cli.invocations[0]?.environment).toHaveProperty("OPERATE_READ_ONLY", "1")
  })

  test("has no problems when the engine lists none", async () => {
    const { runtime } = fakeRuntime([
      { command: VALIDATE, stdout: '{"instructionReports":[],"variableReports":{}}' },
    ])

    expect(await runtime.checkMigration(PLAN)).toEqual({ problems: [] })
  })
})

describe("migrating instances", () => {
  const runningTwo: FakeRoute = {
    command: RUNNING_QUERY,
    stdout: JSON.stringify([historicRow(IDS[0]!), historicRow(IDS[2]!)]),
  }
  const accepting: FakeRoute = { command: EXECUTE, stdout: JSON.stringify(BATCH_FIELDS) }

  test("submits only the instances still running on the source as one batch", async () => {
    const { commands, cli } = fakeCommands([runningTwo, accepting])

    expect(await commands.migrateInstances(PLAN, IDS)).toBe(BATCH)
    expect(JSON.parse(cli.invocations[0]?.input ?? "{}")).toMatchObject({
      processDefinitionId: SOURCE,
      processInstanceIds: IDS,
      unfinished: true,
    })
    expect(cli.commands()[0]!.slice(-2)).toEqual(["--max-results", "3"])
    expect(JSON.parse(cli.invocations[1]?.input ?? "{}")).toEqual({
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
    expect(cli.invocations[1]?.environment).not.toHaveProperty("OPERATE_READ_ONLY")
  })

  test("is rejected without a batch when none of the instances runs on the source", async () => {
    const { commands, cli } = fakeCommands([{ command: RUNNING_QUERY, stdout: "[]" }])

    expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe("rejected")
    expect(cli.commands()).toHaveLength(1)
  })

  test("says nothing was submitted when it could not check which instances still run", async () => {
    const { commands, cli } = fakeCommands([
      { command: RUNNING_QUERY, ...failure(8, "NETWORK", "connect ECONNREFUSED") },
    ])

    const error = await commands.migrateInstances(PLAN, IDS).then(
      () => undefined,
      (caught: unknown) => caught as RuntimeError,
    )

    expect(error).toMatchObject({ failure: "rejected" })
    expect(error?.message).toContain("so it submitted nothing")
    expect(cli.commands()).toHaveLength(1)
  })

  test("keeps a refused login of the check as it is", async () => {
    const { commands } = fakeCommands([
      { command: RUNNING_QUERY, ...failure(4, "UNAUTHORIZED", "no") },
    ])

    expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe("unauthorized")
  })

  test.each([
    [6, "HTTP_CLIENT_ERROR", "rejected"],
    [7, "HTTP_SERVER_ERROR", "engineFailure"],
  ])(
    "leaves the outcome open only when the engine failed after exit %i",
    async (exitCode, code, kind) => {
      const { commands } = fakeCommands([
        runningTwo,
        { command: EXECUTE, ...failure(exitCode, code, "no") },
      ])

      expect(await failureOf(commands.migrateInstances(PLAN, IDS))).toBe(kind)
    },
  )
})

describe("a migration batch", () => {
  test("reads as a migration", async () => {
    const { runtime } = fakeRuntime([
      {
        command: STATISTICS,
        stdout: JSON.stringify([
          { ...BATCH_FIELDS, suspended: false, completedJobs: 1, failedJobs: 4 },
        ]),
      },
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
    const { runtime, cli } = fakeRuntime([
      {
        command: STATISTICS,
        stdout: JSON.stringify([
          { ...BATCH_FIELDS, suspended: false, completedJobs: 1, failedJobs: 3 },
        ]),
      },
      {
        command: ["job", "list"],
        stdout: JSON.stringify([
          {
            id: "job-1",
            exceptionMessage:
              "ENGINE-23004 Cannot migrate process instance '98d32cdf-1':\n\tCannot migrate activity instance 'Activity_ReviewOrder:98d353f6':\n\t\tThere is no migration instruction for this instance's activity\n",
          },
          { id: "job-2", exceptionMessage: long },
          { id: "job-3" },
        ]),
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
    expect(cli.commands()[1]).toEqual([
      "job",
      "list",
      "--job-definition-id",
      JOB_DEFINITION,
      "--with-exception",
      "--no-retries-left",
      "--max-results",
      "100",
    ])
    expect(cli.invocations[1]?.environment).toHaveProperty("OPERATE_READ_ONLY", "1")
  })

  test("has no failures to read once it left the runtime or when none failed", async () => {
    const ended = fakeRuntime([{ command: STATISTICS, stdout: "[]" }])
    expect(await ended.runtime.getBulkFailures(BATCH)).toEqual([])

    const clean = fakeRuntime([
      {
        command: STATISTICS,
        stdout: JSON.stringify([
          { ...BATCH_FIELDS, suspended: false, completedJobs: 5, failedJobs: 0 },
        ]),
      },
    ])
    expect(await clean.runtime.getBulkFailures(BATCH)).toEqual([])
  })
})
