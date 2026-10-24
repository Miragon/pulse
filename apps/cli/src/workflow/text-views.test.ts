/** The text views of the workflow commands (text-views.ts): advance, retry, deploy, status, batch. */

import { describe, expect, it } from "vitest"
import { advanceText, batchText, deployText, retryText, statusText } from "./text-views.js"
import type { InstanceView } from "./types.js"

describe("view texts", () => {
  const instance: InstanceView = {
    id: "p1",
    definition: { key: "k", id: "k:1:x" },
    state: "COMPLETED",
    waitingAt: [],
    incidents: [],
    children: [],
    next: [],
  }

  it("renders advance, with the job executor and without via", () => {
    expect(
      advanceText(
        {
          advanced: {
            processInstanceId: "p1",
            activityId: "book",
            kind: "asyncContinuation",
            id: "j1",
            via: ["POST /job/j1/execute"],
            executedBy: "jobExecutor",
          },
          instance,
        },
        80,
      ),
    ).toMatch(
      /^Advanced {2}book \(asyncContinuation\) via POST \/job\/j1\/execute \(executed by the job executor\)\n\nProcess instance {2}p1\n/,
    )
    expect(
      advanceText(
        {
          advanced: { processInstanceId: "p1", activityId: "a", kind: "userTask", id: "t" },
          instance,
        },
        80,
      ),
    ).toMatch(/^Advanced {2}a \(userTask\)\n/)
  })

  it("renders retry with a failed entry and the instance", () => {
    const text = retryText(
      {
        retried: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
        gone: 0,
        incidents: [
          {
            incidentId: "i1",
            type: "failedJob",
            activityId: "book",
            processInstanceId: "p1",
            action: "retries=1, execute",
            result: "failed",
            rootCause: "boom",
          },
        ],
        instance,
      },
      80,
    )
    expect(text).toMatch(
      /^INCIDENT {2}TYPE {7}ACTIVITY {2}RESULT {2}ROOT CAUSE\ni1 {8}failedJob {2}book {6}failed {2}boom\n\nRetried 1, succeeded 0, failed 1, skipped 0, gone 0\n\nProcess instance {2}p1\n/,
    )
  })

  it("renders deploy with resources without definitions", () => {
    const text = deployText(
      {
        deploymentId: "d1",
        name: "operate",
        changed: true,
        deploymentTime: "t",
        resources: [
          { resource: "a.form", status: "deployed", definitions: [] },
          {
            resource: "b.dmn",
            status: "unchanged",
            definitions: [
              { type: "decision", key: "b", version: 2, id: "b:2" },
              { type: "drd", key: "bd", version: 1, id: "bd:1" },
            ],
          },
        ],
        instance,
      },
      80,
    )
    expect(text).toBe(
      [
        "Deployment  d1 (operate, changed)",
        "Time        t",
        "",
        "Resources:",
        "RESOURCE  STATUS     TYPE      KEY  VERSION",
        "a.form    deployed",
        "b.dmn     unchanged  decision  b    2",
        "b.dmn     unchanged  drd       bd   1",
        "",
        "Process instance  p1",
        "State             COMPLETED",
        "Definition        k",
        "",
      ].join("\n"),
    )
  })

  it("renders status with every section", () => {
    const text = statusText(
      {
        engine: { url: "http://h/engine-rest", engine: "second", version: null, latencyMs: 1500 },
        status: "critical",
        findings: [
          { severity: "critical", code: "JOBS_OVERDUE", message: "m", next: "pulse-cli job list" },
          { severity: "warning", code: "X", message: "w" },
        ],
        definitions: [
          { key: "k", latestVersion: 1, versions: 1, instances: 2, failedJobs: 1, incidents: 1 },
        ],
        incidents: [
          {
            processDefinitionKey: "k",
            activityId: "a",
            type: "failedJob",
            message: "msg",
            count: 1,
            firstAt: "f",
            lastAt: "l",
            processInstanceIds: [],
            next: "n",
          },
        ],
        incidentsTotal: 2,
        propagated: 1,
        externalTasks: [
          { topic: "t", waiting: 1, locked: 2, lockExpired: 0, failed: 0, workers: ["w1", "w2"] },
        ],
        jobs: { executable: 3, overdue: 1, oldestReadySince: "o" },
        tasks: { open: 4 },
        truncated: ["incidents: 2000 of 2001 loaded"],
      },
      120,
    )
    expect(text).toContain(
      "Engine  http://h/engine-rest (engine second, version unknown, 1.5s)\nStatus  critical\n",
    )
    expect(text).toContain(
      "\nFindings:\n  critical  m\n            next: pulse-cli job list\n  warning   w\n",
    )
    expect(text).toContain(
      "\nDefinitions:\nKEY  VERSIONS  INSTANCES  INCIDENTS  FAILED JOBS\nk    1         2          1          1\n",
    )
    expect(text).toContain(
      "\nIncidents:\nCOUNT  KEY  ACTIVITY  TYPE       LAST  ROOT CAUSE\n1      k    a         failedJob  l     msg\n",
    )
    expect(text).toContain(
      "\nExternal tasks:\nTOPIC  WAITING  LOCKED  EXPIRED  FAILED  OLDEST  WORKERS\nt      1        2       0        0               w1, w2\n",
    )
    expect(text).toMatch(
      /\nJobs {7}3 executable, 1 overdue \(oldest since o\)\nTasks {6}4 open\nIncidents {2}2 open, 1 propagated\nTruncated {2}incidents: 2000 of 2001 loaded\n$/,
    )
  })

  it("renders a batch", () => {
    expect(batchText({ batch: { id: "b1", type: "deletion", totalJobs: 3, failedJobs: 1 } })).toBe(
      "Batch        b1 (deletion)\nTotal jobs   3\nFailed jobs  1\n",
    )
  })
})

describe("view texts, other shapes", () => {
  it("renders a quiet status exactly", () => {
    const text = statusText(
      {
        engine: { url: "http://h", version: "7.24.0", latencyMs: 12 },
        status: "ok",
        findings: [],
        definitions: [],
        incidents: [
          {
            processDefinitionKey: "k",
            activityId: "a",
            type: "failedJob",
            message: "msg",
            rootCause: "IOException: x",
            count: 2,
            firstAt: "f",
            lastAt: "l",
            processInstanceIds: [],
            next: "n",
          },
        ],
        incidentsTotal: 0,
        propagated: 0,
        externalTasks: [
          {
            topic: "t",
            waiting: 1,
            locked: 0,
            lockExpired: 0,
            failed: 0,
            workers: [],
            oldestWaitingSince: "o",
          },
        ],
        jobs: { executable: 3, overdue: 0 },
        tasks: { open: 0 },
        batches: { running: 1, withFailures: 0 },
      },
      120,
    )
    expect(text).toBe(
      [
        "Engine  http://h (version 7.24.0, 12ms)",
        "Status  ok",
        "",
        "Incidents:",
        "COUNT  KEY  ACTIVITY  TYPE       LAST  ROOT CAUSE",
        "2      k    a         failedJob  l     IOException: x",
        "",
        "External tasks:",
        "TOPIC  WAITING  LOCKED  EXPIRED  FAILED  OLDEST  WORKERS",
        "t      1        0       0        0       o",
        "",
        "Jobs       3 executable",
        "Tasks      0 open",
        "Batches    1 running, 0 with failures",
        "Incidents  0 open, 0 propagated",
        "",
      ].join("\n"),
    )
    const overdue = statusText(
      {
        engine: { url: "http://h", version: "1", latencyMs: 1 },
        status: "warning",
        findings: [{ severity: "warning", code: "X", message: "w", next: "pulse-cli x" }],
        definitions: [],
        incidents: [],
        incidentsTotal: 0,
        propagated: 0,
        externalTasks: [],
        jobs: { executable: 3, overdue: 2 },
        tasks: { open: 0 },
      },
      120,
    )
    expect(overdue).toContain("\nFindings:\n  warning  w\n           next: pulse-cli x\n")
    expect(overdue).toContain("\nJobs       3 executable, 2 overdue\n")
  })

  it("renders retry without incidents and advance with an empty via", () => {
    expect(
      retryText({ retried: 0, succeeded: 0, failed: 0, skipped: 0, gone: 0, incidents: [] }, 80),
    ).toBe("No open incidents to retry.\nRetried 0, succeeded 0, failed 0, skipped 0, gone 0\n")
    const instance: InstanceView = {
      id: "p1",
      definition: { key: "k", id: "k:1:x" },
      state: "ACTIVE",
      waitingAt: [],
      incidents: [],
      children: [],
      next: [],
    }
    expect(
      advanceText(
        {
          advanced: {
            processInstanceId: "p1",
            activityId: "a",
            kind: "userTask",
            id: "t",
            via: [],
          },
          instance,
        },
        80,
      ),
    ).toMatch(/^Advanced {2}a \(userTask\)\n\nProcess instance/)
    expect(
      deployText(
        { deploymentId: "d", name: "n", changed: false, deploymentTime: "t", resources: [] },
        80,
      ),
    ).toBe("Deployment  d (n, unchanged)\nTime        t\n")
  })

  it("renders a finished batch with times and the wait", () => {
    expect(
      batchText({
        batch: { id: "b1", type: "deletion", totalJobs: 3, startTime: "s", endTime: "e" },
        waited: { until: "finished", elapsedMs: 1500, polls: 3 },
      }),
    ).toBe(
      "Batch       b1 (deletion)\nTotal jobs  3\nStarted     s\nEnded       e\nWaited      finished after 1.5s (3 polls)\n",
    )
  })
})
