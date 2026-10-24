/** The outcome errors, their texts and the dry-run output (outcomes.ts, dry-run.ts). */

import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import { BASE_URL, fakeServer } from "../../test/support/fake-fetch.js"
import { basicAuth } from "../auth/basic.js"
import { dryRunOutput, dryRunText } from "./dry-run.js"
import { endedError, incidentError, jobFailedError, timeoutError } from "./outcomes.js"

describe("outcomes", () => {
  it("builds the errors of exit code 9 with their data", () => {
    expect(incidentError("p1", []).message).toBe("Process instance p1 has an incident")
    const two = [
      { id: "a", type: "failedJob", activityId: "x", message: "m", since: "s" },
      { id: "b", type: "failedJob", activityId: "y", since: "s" },
    ]
    expect(incidentError("p1", two)).toMatchObject({
      code: "INCIDENT",
      exitCode: 9,
      message: "Process instance p1 has 2 incidents, the first: failedJob at x: m",
    })
    expect(incidentError("p1", [two[1]!]).message).toBe(
      "Process instance p1 has an incident: failedJob at y: ",
    )
    // the view on stdout has message and root cause: the error names the incidents only
    expect(
      incidentError("p1", [
        { ...two[0]!, rootCause: "r", processInstanceId: "c1", stacktrace: ["at x"] },
      ]).details.data,
    ).toEqual({
      incidents: [{ id: "a", type: "failedJob", activityId: "x", processInstanceId: "c1" }],
    })
    expect(
      timeoutError("p1", ["task", "ended"], 120_000, { elapsedMs: 120_000, polls: 63 }),
    ).toMatchObject({
      code: "WAIT_TIMEOUT",
      message: "Timed out after 2m waiting until task or ended (process instance p1)",
    })
    expect(endedError("p1", ["task"], "COMPLETED")).toMatchObject({
      code: "INSTANCE_ENDED",
      details: { hint: "`operate inspect p1 --history` shows the path it took." },
    })
    const failures = [
      { jobId: "j1", message: "boom", rootCause: "r" },
      { jobId: "j2", message: "x", rootCause: "y", processInstanceId: "p2" },
    ]
    expect(jobFailedError(failures)).toMatchObject({
      code: "JOB_FAILED",
      message: "Job j1 failed: boom (and 1 more)",
      details: {
        hint: "`operate inspect <id> --stacktrace` shows the stacktrace; fix the cause, then retry.",
      },
    })
    expect(jobFailedError([]).message).toBe("Job failed")
  })
})

describe("dryRunOutput", () => {
  it("previews the planned requests with masked secrets and curl lines", async () => {
    const auth = basicAuth({
      type: "basic",
      username: "demo",
      password: "secret",
      sources: { username: "flag", password: "flag" },
    })
    const port = portOf(fakeServer().fetch, { auth })
    const { view, notes } = await dryRunOutput(
      {
        plan: { a: 1 },
        requests: [
          { operationId: "getRestAPIVersion", input: { pathArgs: [], query: {} } },
          {
            summary: "complete user task t1",
            operationId: "complete",
            input: { pathArgs: ["t1"], query: {}, body: {} },
          },
        ],
      },
      port,
      false,
    )
    expect(notes).toEqual([])
    expect(view.plan).toEqual({ a: 1 })
    expect(view.requests[0]).toMatchObject({
      method: "GET",
      url: `${BASE_URL}/version`,
      headers: { Authorization: "Basic ***" },
    })
    expect(view.requests[1]).toMatchObject({
      summary: "complete user task t1",
      method: "POST",
      body: {},
    })
    expect(dryRunText(view)).toBe(
      `${view.requests[0]?.curl}\n# complete user task t1\n${view.requests[1]?.curl}\n`,
    )
    expect(await dryRunOutput({ requests: [] }, port, true)).toEqual({
      view: { requests: [] },
      notes: [],
    })
    const revealed = await dryRunOutput(
      { requests: [{ operationId: "getRestAPIVersion", input: { pathArgs: [], query: {} } }] },
      port,
      true,
    )
    expect(JSON.stringify(revealed.view)).toContain("Basic ZGVtbzpzZWNyZXQ=")
  })

  it("collects the note of the auth preview once, e.g. a missing OAuth login", async () => {
    const note = 'Not logged in with OAuth (profile "sso")'
    const auth = {
      type: "oauth",
      headers: () => Promise.resolve({}),
      preview: () => Promise.resolve({ headers: {}, note }),
    }
    const version = { operationId: "getRestAPIVersion", input: { pathArgs: [], query: {} } }
    const { view, notes } = await dryRunOutput(
      { requests: [version, version] },
      portOf(fakeServer().fetch, { auth }),
      false,
    )
    expect(notes).toEqual([note])
    expect(view.requests).toHaveLength(2)
    expect(view.requests[0]?.headers).not.toHaveProperty("Authorization")
  })
})

describe("outcome texts", () => {
  it("name the fix and join several conditions with or", () => {
    expect(incidentError("p1", []).details.hint).toBe(
      "Fix the cause, then run `operate retry p1`; --no-fail-on-incident keeps waiting despite incidents.",
    )
    expect(timeoutError("p1", ["idle"], 1000, { elapsedMs: 1000, polls: 4 }).details.hint).toBe(
      "The job executor may be backing off (up to 60 s on an idle engine): raise --wait-timeout, execute due jobs with `operate wait p1 --execute-jobs`, or run `operate status` to see overdue jobs.",
    )
    const message = {
      activityId: "paid",
      kind: "message" as const,
      eventSubscriptionId: "s",
      executionId: "e",
    }
    const progress = { elapsedMs: 1000, polls: 4 }
    expect(
      timeoutError("p1", ["task"], 1000, { ...progress, idleAt: [message] }).details.hint,
    ).toBe(
      "No job is due: the instance rests at paid (message). Move it with `operate advance p1`, or check the --until condition against `operate inspect p1`.",
    )
    const four = ["a", "b", "c", "d"].map((activityId) => ({ ...message, activityId }))
    expect(
      timeoutError("p1", ["task"], 1000, { ...progress, idleAt: four }).details.hint,
    ).toContain("rests at a (message), b (message), c (message), ...")
    expect(timeoutError("p1", ["idle"], 1000, { ...progress, idleAt: [] }).details.hint).toMatch(
      /^The job executor may be backing off/,
    )
    // advance refuses a suspended job: the hint names the activation instead
    const suspended = {
      activityId: "work",
      kind: "asyncContinuation" as const,
      jobId: "j1",
      retries: 3,
      suspended: true as const,
    }
    expect(
      timeoutError("p1", ["task"], 1000, { ...progress, idleAt: [suspended] }).details.hint,
    ).toBe(
      "No job is due: the instance rests at work (asyncContinuation, suspended). Activate the suspended job with `operate job activate j1`, or check the --until condition against `operate inspect p1`.",
    )
    expect(
      timeoutError("p1", ["task"], 1000, { ...progress, idleAt: [suspended, message] }).details
        .hint,
    ).toContain("Move it with `operate advance p1`")
    expect(endedError("p1", ["task", "activity:x"], "COMPLETED").message).toBe(
      "Process instance p1 ended (COMPLETED) before reaching task or activity:x",
    )
  })
})
