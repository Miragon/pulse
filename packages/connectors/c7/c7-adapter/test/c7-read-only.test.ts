import {
  BulkOperationId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  RuntimeError,
  type MigrationPlan,
  type ProcessCommands,
} from "@miragon/pulse-engine-core"
import { Problems } from "@miragon/pulse-runtime-view/core"
import { describe, expect, test } from "vitest"
import { fakeCommands } from "./support/fake-engine.js"
import { REST_URL, type RestRoute } from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS } from "./support/fixtures.js"

const INCIDENT = IncidentId("993d2801-cd91-11f1-9c88-32e5612dd01b")
const JOB = "993d2800-cd91-11f1-9c88-32e5612dd01b"
const INSTANCE = InstanceId(WORLD_IDS.review)
const BATCH = BulkOperationId("c7736a0b-cf02-11f1-b08e-3a9a38134a51")
const SOURCE = DefinitionId(WORLD_IDS.order1)
const REVIEW_ORDER = ElementId("Activity_ReviewOrder")
const ENGINE = { name: "local", environment: "local", host: "engine.test" } as const

const PLAN: MigrationPlan = {
  sourceDefinitionId: SOURCE,
  targetDefinitionId: DefinitionId("pulse-order:2:8d1c0f62-cf22-11f1-abf2-ce3814910ef6"),
  mappings: [{ sourceElementId: REVIEW_ORDER, targetElementId: REVIEW_ORDER }],
}

interface WriteOnReadOnly {
  readonly reads: readonly RestRoute[]
  readonly refused: string
  readonly attempt: (commands: ProcessCommands) => Promise<unknown>
}

const WRITES: Readonly<Record<keyof ProcessCommands, WriteOnReadOnly>> = {
  retryIncident: {
    reads: [
      {
        route: `GET /incident/${INCIDENT}`,
        answer: {
          id: INCIDENT,
          rootCauseIncidentId: INCIDENT,
          incidentType: "failedJob",
          configuration: JOB,
        },
      },
    ],
    refused: `PUT ${REST_URL}/job/${JOB}/retries`,
    attempt: (commands) => commands.retryIncident(INCIDENT),
  },
  setVariable: {
    reads: [],
    refused: `PUT ${REST_URL}/process-instance/${INSTANCE}/variables/amount`,
    attempt: (commands) =>
      commands.setVariable(INSTANCE, { name: "amount", valueJson: "43", type: "Integer" }),
  },
  moveToken: {
    reads: [
      {
        route: `GET /process-instance/${INSTANCE}/activity-instances`,
        answer: new Response(fixture("activity-instances-review.json")),
      },
    ],
    refused: `POST ${REST_URL}/process-instance/${INSTANCE}/modification`,
    attempt: (commands) =>
      commands.moveToken(INSTANCE, {
        fromElementId: REVIEW_ORDER,
        toElementId: REVIEW_ORDER,
        reason: "Moved by hand after the outage",
      }),
  },
  cancelInstances: {
    reads: [],
    refused: `POST ${REST_URL}/process-instance/delete`,
    attempt: (commands) => commands.cancelInstances([INSTANCE], { reason: "test data" }),
  },
  migrateInstances: {
    reads: [
      {
        route: "POST /history/process-instance",
        answer: [
          {
            id: INSTANCE,
            processDefinitionId: SOURCE,
            processDefinitionKey: "pulse-order",
            processDefinitionVersion: 1,
            state: "ACTIVE",
          },
        ],
      },
    ],
    refused: `POST ${REST_URL}/migration/executeAsync`,
    attempt: (commands) => commands.migrateInstances(PLAN, [INSTANCE]),
  },
  stopBulkOperation: {
    reads: [],
    refused: `PUT ${REST_URL}/batch/${BATCH}/suspended`,
    attempt: (commands) => commands.stopBulkOperation(BATCH),
  },
}

function readOnlyMessage(refused: string): string {
  return `Read-only. This connection only reads, so Pulse did not send ${refused}.`
}

async function failureOf(attempt: Promise<unknown>): Promise<RuntimeError> {
  const error = await attempt.then(
    () => undefined,
    (failure: unknown) => failure,
  )
  if (!RuntimeError.is(error)) {
    throw new Error(`expected a RuntimeError, got ${String(error)}`)
  }
  return error
}

describe("a write on a connection that only reads", () => {
  test.each(Object.entries(WRITES))(
    "%s fails as unsupported before anything is written, never as a missing resource",
    async (_command, write) => {
      const { commands, engine } = fakeCommands(write.reads, {}, false)

      const error = await failureOf(write.attempt(commands))

      expect({ failure: error.failure, message: error.message, hint: error.hint }).toEqual({
        failure: "unsupported",
        message: readOnlyMessage(write.refused),
        hint: undefined,
      })
      expect(engine.requests.map((request) => request.route)).toEqual(
        write.reads.map((read) => read.route),
      )
    },
  )

  test("leaves the incident of a retry as it is, never reported gone", async () => {
    const { commands } = fakeCommands(WRITES.retryIncident.reads, {}, false)

    const error = await failureOf(commands.retryIncident(INCIDENT))

    expect(error.failure).not.toBe("rejected")
    expect(error.message).not.toMatch(/gone|did not retry/)
  })

  test("words it through the runtime view's Problems: the read-only text, no edit of the connection", async () => {
    const { commands } = fakeCommands([], {}, false)

    const problem = Problems.of(await failureOf(commands.stopBulkOperation(BATCH)), ENGINE)

    expect(problem).toEqual({
      title: "local cannot do this.",
      detail: readOnlyMessage(WRITES.stopBulkOperation.refused),
      canEditConnection: false,
    })
  })
})
