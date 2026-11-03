import { describe, expect, it } from "vitest"
import { engineStatus, type FindingInput, findings } from "./findings.js"
import type { IncidentGroup } from "./status.js"
import { NOW } from "./testing/status.js"
import { omit } from "./util.js"

const QUIET: FindingInput = {
  jobs: { executable: 0, overdue: 0 },
  incidents: [],
  externalTasks: [],
  batches: [],
  staleAfterMs: 300_000,
  now: NOW,
}

const GROUP: IncidentGroup = {
  processDefinitionKey: "order",
  activityId: "book",
  type: "failedJob",
  message: "boom",
  count: 2,
  firstAt: "a",
  lastAt: "b",
  rootCause: "PropertyNotFoundException: missingBean",
  processInstanceIds: ["p1"],
  next: { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
}

const topic = {
  topic: "mail",
  waiting: 3,
  locked: 0,
  lockExpired: 1,
  failed: 0,
  workers: [],
  oldestWaitingSince: "2026-01-01T11:00:00.000+0000",
  oldestLockExpiredAt: "2026-01-01T11:30:00.000+0000",
}

describe("findings", () => {
  it("finds nothing on a quiet engine", () => {
    expect(findings(QUIET)).toEqual([])
    expect(engineStatus([])).toBe("ok")
  })

  it("reports every rule with its step, critical first, then by code and message", () => {
    const list = findings({
      ...QUIET,
      jobs: { executable: 3, overdue: 1 },
      incidents: [GROUP, { ...omit(GROUP, "rootCause"), processDefinitionKey: "" }],
      externalTasks: [
        topic,
        {
          ...topic,
          topic: "fresh",
          oldestWaitingSince: "2026-01-01T11:59:00.000+0000",
          lockExpired: 0,
        },
      ],
      batches: [
        { id: "b1", type: "migration", failedJobs: 2, batchJobDefinitionId: "jd-b" },
        { id: "b2", type: "deletion", failedJobs: 1 },
        { id: "b3", type: "deletion", failedJobs: 0 },
      ],
      unknownKeys: ["nope"],
    })
    expect(
      list.map((finding) => [finding.severity, finding.code, finding.message, finding.next]),
    ).toEqual([
      [
        "critical",
        "JOBS_OVERDUE",
        "1 executable job has waited longer than 5m: is the job executor running?",
        { action: "listOverdueJobs" },
      ],
      [
        "warning",
        "BATCH_FAILURES",
        "batch b1 (migration): 2 failed jobs",
        { action: "listFailedJobs", jobDefinitionId: "jd-b" },
      ],
      [
        "warning",
        "BATCH_FAILURES",
        "batch b2 (deletion): 1 failed job",
        { action: "listFailedJobs" },
      ],
      [
        "warning",
        "INCIDENTS",
        "2 failedJob incidents at job definition (unknown): boom",
        GROUP.next,
      ],
      [
        "warning",
        "INCIDENTS",
        "2 failedJob incidents at order/book: PropertyNotFoundException: missingBean",
        GROUP.next,
      ],
      [
        "warning",
        "LOCK_EXPIRED",
        "topic mail: 1 task with an expired lock (the oldest since 2026-01-01T11:30:00.000+0000): a worker crashed or exceeded its lock",
        { action: "listExpiredLocks", topic: "mail" },
      ],
      [
        "warning",
        "NO_WORKER",
        "topic mail: 3 tasks wait since 2026-01-01T11:00:00.000+0000, none is locked: is a worker subscribed?",
        { action: "listUnlockedTasks", topic: "mail" },
      ],
      [
        "warning",
        "UNKNOWN_KEY",
        "process definition key nope is not deployed",
        { action: "listDefinitions" },
      ],
    ])
    expect(engineStatus(list)).toBe("critical")
  })

  it("carries the step of its group", () => {
    const step = {
      action: "listIncidentsAtActivity",
      processDefinitionKey: "order",
      activityId: "book",
    } as const
    const list = findings({ ...QUIET, incidents: [{ ...GROUP, next: step }] })
    expect(list.map((finding) => finding.next)).toEqual([step])
    expect(
      findings({ ...QUIET, jobs: { executable: 2, overdue: 2, oldestReadySince: "t" } })[0]
        ?.message,
    ).toBe(
      "2 executable jobs have waited longer than 5m (oldest since t): is the job executor running?",
    )
  })
})
