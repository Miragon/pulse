import { describe, expect, it } from "vitest"
import { errorOf, workflowSetup } from "../../../test/support/cli-workflow.js"
import type { FakeRuntimeOptions } from "../../../test/support/fake-runtime.js"
import { ENGINE_URL, routes, type Stage } from "../../../test/support/workflow-engine.js"
import { run } from "../run.js"

const setup = (stage?: Stage, options?: FakeRuntimeOptions) => workflowSetup(run, stage, options)

describe("pulse-cli inspect", () => {
  it("prints the instance view of a business key as JSON", async () => {
    const { cli, engine } = setup()
    const result = await cli(["inspect", "--business-key", "B-1"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    const view = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(view)).toEqual(
      [
        "id",
        "businessKey",
        "definition",
        "state",
        "startTime",
        "rootId",
        "waitingAt",
        "incidents",
        "children",
        "variables",
        "next",
      ].filter((key) => key !== "rootId"),
    )
    expect(view).toMatchObject({
      id: "pi-1",
      state: "ACTIVE",
      waitingAt: [
        { activityId: "approve", kind: "userTask", taskId: "task-1", activityType: "userTask" },
      ],
      next: ["pulse-cli advance pi-1"],
    })
    expect(routes(engine).slice(0, 2)).toEqual([
      "GET /history/process-instance",
      "GET /process-instance",
    ])
  })

  it("prints sections on -o table, projections with --fields and warns about unknown fields", async () => {
    const { cli } = setup()
    const table = await cli(["inspect", "pi-1", "-o", "table"])
    expect(table.stdout).toContain("Process instance  pi-1\n")
    expect(table.stdout).toContain(
      "\nWaiting at:\nACTIVITY  KIND      ID      DETAIL   INSTANCE\napprove   userTask  task-1  Approve\n",
    )
    expect(table.stdout).toContain("\nNext:\n  pulse-cli advance pi-1\n")
    const fields = await cli(["inspect", "pi-1", "--fields", "id,state,nope"])
    expect(fields.stdout).toBe('{"id":"pi-1","state":"ACTIVE"}\n')
    expect(fields.stderr).toMatch(/^Warning: field "nope" not found in the response \(fields: id, /)
    const projected = await cli(["inspect", "pi-1", "--fields", "id,state", "-o", "table"])
    expect(projected.stdout).toBe("FIELD  VALUE\nid     pi-1\nstate  ACTIVE\n")
  })

  it("writes the JSON view to --out-file", async () => {
    const { cli, runtime } = setup()
    const result = await cli(["inspect", "pi-1", "--out-file", "view.json"])
    expect(result.code).toBe(0)
    const summary = JSON.parse(result.stdout) as { bytes: number; contentType: string }
    expect(summary).toMatchObject({ outFile: "view.json", contentType: "application/json" })
    const written = new TextDecoder().decode(runtime.files.get("view.json")?.data)
    expect(JSON.parse(written)).toMatchObject({ id: "pi-1" })
    expect(summary.bytes).toBe(new TextEncoder().encode(written).length)
  })

  it("sends nothing with --dry-run and previews the first round", async () => {
    const { cli, engine } = setup()
    const result = await cli(["inspect", "--business-key", "B-1", "--dry-run"])
    expect(result.code).toBe(0)
    expect(engine.requests).toEqual([])
    const preview = JSON.parse(result.stdout) as {
      plan?: unknown
      requests: { url: string; curl: string }[]
    }
    expect(preview.plan).toBeUndefined()
    expect(preview.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/engine-rest/history/process-instance",
      "/engine-rest/process-instance",
    ])
    const table = await cli(["inspect", "pi-1", "--dry-run", "-o", "table"])
    expect(table.stdout).toBe(
      `curl '${ENGINE_URL}/process-instance/pi-1' -H 'Accept: application/json'\ncurl '${ENGINE_URL}/history/process-instance/pi-1' -H 'Accept: application/json'\n`,
    )
  })

  it("prefixes every request with --engine and works in read-only mode", async () => {
    const { cli, engine } = setup()
    const result = await cli(["inspect", "pi-1", "--engine", "second", "--read-only"])
    expect(result.code).toBe(0)
    expect(engine.requests.length).toBeGreaterThan(5)
    expect(
      engine.requests.every((request) => request.url.startsWith(`${ENGINE_URL}/engine/second/`)),
    ).toBe(true)
  })

  it("reports an unknown instance as NOT_FOUND and wrong selections as usage errors", async () => {
    const { cli } = setup("none")
    const missing = await cli(["inspect", "nope"])
    expect(missing.code).toBe(5)
    expect(missing.stdout).toBe("")
    expect(errorOf(missing.stderr)).toMatchObject({
      code: "NOT_FOUND",
      message: "Process instance nope does not exist (neither running nor in the history)",
    })
    const both = await cli(["inspect", "pi-1", "--business-key", "B-1"])
    expect(errorOf(both.stderr)).toMatchObject({
      code: "USAGE",
      message:
        "The process instance id excludes --business-key, --process-definition-key and --latest",
    })
    const none = await cli(["inspect"])
    expect(errorOf(none.stderr)).toMatchObject({
      code: "USAGE",
      message: "Select a process instance",
    })
  })
})

describe("pulse-cli wait", () => {
  it('prints the instance view with "waited" once the instance is idle', async () => {
    const { cli } = setup()
    const result = await cli(["wait", "--business-key", "B-1", "--no-variables"])
    expect(result.code).toBe(0)
    const view = JSON.parse(result.stdout) as Record<string, unknown>
    expect(view.waited).toEqual({ until: "idle", elapsedMs: 0, polls: 1 })
    expect(view.variables).toBeUndefined()
    const table = await cli(["wait", "pi-1", "-o", "table"])
    expect(table.stdout).toContain("Waited            idle after 0ms (1 poll)\n")
  })

  it("times out with exit code 9, the view on stdout and a doubling poll interval", async () => {
    const { cli, runtime } = setup()
    const result = await cli(["wait", "pi-1", "--until", "ended", "--wait-timeout", "5s"])
    expect(result.code).toBe(9)
    expect(JSON.parse(result.stdout)).toMatchObject({ id: "pi-1", state: "ACTIVE" })
    expect(errorOf(result.stderr)).toMatchObject({
      code: "WAIT_TIMEOUT",
      exitCode: 9,
      message: "Timed out after 5s waiting until ended (process instance pi-1)",
      data: { until: ["ended"], elapsedMs: 5000, polls: 6 },
    })
    expect(runtime.sleeps).toEqual([250, 500, 1000, 2000, 1250])
  })

  it("fails fast with INCIDENT when the job executor fails the job", async () => {
    const { cli } = setup("book")
    const result = await cli(["wait", "pi-1"])
    expect(result.code).toBe(9)
    const view = JSON.parse(result.stdout) as { incidents: { rootCause: string }[] }
    expect(view.incidents[0]?.rootCause).toBe(
      "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    )
    expect(errorOf(result.stderr)).toMatchObject({
      code: "INCIDENT",
      message:
        "Process instance pi-1 has an incident: failedJob at book: PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    })
  })

  it("executes due jobs with --execute-jobs and reports a failed job", async () => {
    const { cli, engine } = setup("book")
    const result = await cli(["wait", "pi-1", "--execute-jobs"])
    expect(result.code).toBe(9)
    expect(errorOf(result.stderr)).toMatchObject({ code: "JOB_FAILED" })
    expect(routes(engine)).toContain("POST /job/job-1/execute")
    const refused = await cli(["wait", "pi-1", "--execute-jobs", "--read-only"])
    expect(errorOf(refused.stderr)).toMatchObject({
      code: "READ_ONLY",
      message: "`pulse-cli wait` is a write operation and read-only mode is enabled",
    })
  })

  it("waits for a batch and refuses instance options next to --batch", async () => {
    const { cli } = setup()
    const result = await cli(["wait", "--batch", "batch-1"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      batch: {
        id: "batch-1",
        type: "instance-deletion",
        totalJobs: 1,
        startTime: "2026-10-09T10:00:00.000+0000",
        endTime: "2026-10-09T10:00:05.000+0000",
      },
      waited: { until: "finished", elapsedMs: 0, polls: 1 },
    })
    const table = await cli(["wait", "--batch", "batch-1", "-o", "table"])
    expect(table.stdout).toContain("Batch       batch-1 (instance-deletion)\n")
    const conflict = await cli(["wait", "pi-1", "--batch", "b", "--until", "idle"])
    expect(errorOf(conflict.stderr)).toMatchObject({
      code: "USAGE",
      message: "--batch excludes the process instance id, --until",
    })
  })

  it("checks durations and conditions before sending anything", async () => {
    const { cli, engine } = setup()
    expect(errorOf((await cli(["wait", "pi-1", "--wait-timeout", "0"])).stderr)).toMatchObject({
      message: '--wait-timeout expects a duration like 500ms, 30s, 2m or 1h, got "0"',
    })
    expect(errorOf((await cli(["wait", "pi-1", "--until", "done"])).stderr).message).toMatch(
      /^--until expects one of idle, ended/,
    )
    expect(engine.requests).toEqual([])
    const preview = await cli(["wait", "pi-1", "--dry-run"])
    expect(
      (JSON.parse(preview.stdout) as { requests: { url: string }[] }).requests.map(
        (request) => request.url,
      ),
    ).toEqual([`${ENGINE_URL}/process-instance/pi-1`])
    expect(engine.requests).toEqual([])
  })
})

describe("pulse-cli advance", () => {
  it("completes the user task and prints where the instance waits now", async () => {
    const { cli, engine } = setup()
    const result = await cli(["advance", "--business-key", "B-1", "--var", "approved=true"])
    expect(result.code).toBe(0)
    const view = JSON.parse(result.stdout) as {
      advanced: unknown
      instance: { waitingAt: { kind: string }[] }
    }
    expect(view.advanced).toEqual({
      processInstanceId: "pi-1",
      activityId: "approve",
      kind: "userTask",
      id: "task-1",
      via: ["POST /task/task-1/complete"],
    })
    expect(view.instance.waitingAt[0]?.kind).toBe("asyncContinuation")
    expect(engine.variables).toEqual({ approved: { value: true, type: "Boolean" } })
  })

  it("prints the advanced line and the instance on -o table", async () => {
    const { cli } = setup()
    const result = await cli(["advance", "pi-1", "-o", "table"])
    expect(result.stdout).toMatch(
      /^Advanced {2}approve \(userTask\) via POST \/task\/task-1\/complete\n\nProcess instance {2}pi-1\n/,
    )
  })

  it("sends only reads with --dry-run and previews the writes with a summary", async () => {
    const { cli, engine } = setup()
    const result = await cli(["advance", "pi-1", "--dry-run"])
    expect(result.code).toBe(0)
    expect(engine.requests.every((request) => request.method === "GET")).toBe(true)
    expect(engine.stage).toBe("approve")
    const preview = JSON.parse(result.stdout) as {
      plan: unknown
      requests: { summary: string; method: string }[]
    }
    expect(preview.plan).toEqual({
      processInstanceId: "pi-1",
      activityId: "approve",
      kind: "userTask",
      id: "task-1",
    })
    expect(preview.requests).toMatchObject([
      { summary: "complete user task task-1", method: "POST" },
    ])
    const table = await cli(["advance", "pi-1", "--dry-run", "-o", "table"])
    expect(table.stdout).toMatch(/^# complete user task task-1\ncurl -X POST '/)
  })

  it("refuses in read-only mode before any request", async () => {
    const { cli, engine } = setup()
    const result = await cli(["advance", "pi-1", "--read-only"])
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({ code: "READ_ONLY" })
    expect(engine.requests).toEqual([])
  })

  it("waits after the write and fails fast on the incident of the next step", async () => {
    const { cli } = setup()
    const result = await cli(["advance", "pi-1", "--wait"])
    expect(result.code).toBe(9)
    expect(JSON.parse(result.stdout)).toMatchObject({
      advanced: { kind: "userTask" },
      instance: { incidents: [{ type: "failedJob" }] },
    })
    expect(errorOf(result.stderr)).toMatchObject({ code: "INCIDENT" })
  })

  it("executes an asynchronous job and reports its failure with exit code 9", async () => {
    const { cli } = setup("book")
    const result = await cli(["advance", "pi-1"])
    expect(result.code).toBe(9)
    expect(JSON.parse(result.stdout)).toMatchObject({
      advanced: { kind: "asyncContinuation", via: ["POST /job/job-1/execute"] },
    })
    expect(errorOf(result.stderr)).toMatchObject({
      code: "JOB_FAILED",
      message: `Job job-1 at book failed: Unknown property used in expression: \${missingBean.run()}. Cause: Cannot resolve identifier 'missingBean'`,
    })
  })

  it("checks the options before and after reading the instance", async () => {
    const { cli, engine } = setup()
    expect(errorOf((await cli(["advance", "pi-1", "--wait-timeout", "1s"])).stderr)).toMatchObject({
      message: "--wait-timeout needs --wait or --until",
    })
    expect(errorOf((await cli(["advance", "pi-1", "--retries", "1"])).stderr)).toMatchObject({
      message: "--retries needs --fail",
    })
    expect(engine.requests).toEqual([])
    const fail = await cli(["advance", "pi-1", "--fail", "x"])
    expect(errorOf(fail.stderr)).toMatchObject({
      code: "USAGE",
      message: "--fail applies to external tasks only; approve is a userTask",
    })
    const other = await cli(["advance", "pi-1", "--activity-id", "nope"])
    expect(errorOf(other.stderr)).toMatchObject({
      message: "Process instance pi-1 does not wait at nope",
      hint: "It waits at: approve (userTask).",
    })
  })
})
