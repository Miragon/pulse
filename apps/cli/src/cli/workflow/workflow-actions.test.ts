/** `pulse-cli retry`, `deploy` and `status` through `run()` against the fake workflow engine. */

import { describe, expect, it } from "vitest"
import { errorOf, workflowSetup } from "../../../test/support/cli-workflow.js"
import type { FakeRuntimeOptions } from "../../../test/support/fake-runtime.js"
import { ENGINE_URL, type Stage } from "../../../test/support/workflow-engine.js"
import { run } from "../run.js"

const setup = (stage?: Stage, options?: FakeRuntimeOptions) => workflowSetup(run, stage, options)

describe("pulse-cli retry", () => {
  it("retries the failed job of an instance and executes it with --now", async () => {
    const { cli, engine } = setup("failed")
    const result = await cli(["retry", "--business-key", "B-1", "--now"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      retried: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      gone: 0,
      incidents: [
        {
          incidentId: "inc-1",
          type: "failedJob",
          activityId: "book",
          processInstanceId: "pi-1",
          jobId: "job-1",
          action: "retries=1, execute",
          result: "succeeded",
        },
      ],
    })
    expect(engine.stage).toBe("ended")
  })

  it("prints the report table, waits with --wait and refuses --wait without an instance", async () => {
    const { cli } = setup("failed")
    const result = await cli(["retry", "pi-1", "--wait", "--until", "ended", "-o", "table"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(
      /^INCIDENT {2}TYPE {7}ACTIVITY {2}RESULT {3}ROOT CAUSE\ninc-1 {5}failedJob {2}book {6}retried\n\nRetried 1, succeeded 0, failed 0, skipped 0, gone 0\n\nProcess instance {2}pi-1\nState {13}COMPLETED\n/,
    )
    const usage = await cli(["retry", "--incident", "inc-1", "--wait"])
    expect(errorOf(usage.stderr)).toMatchObject({
      message: "--wait and --until need a process instance",
    })
  })

  it("needs --yes for a whole definition, previews with --dry-run and reads named incidents", async () => {
    const { cli, engine } = setup("failed")
    const refused = await cli(["retry", "--process-definition-key", "invoice"])
    expect(errorOf(refused.stderr)).toMatchObject({
      code: "CONFIRMATION_REQUIRED",
      message: "`pulse-cli retry` is a bulk operation and needs confirmation",
    })
    expect(engine.requests).toEqual([])
    const preview = await cli([
      "retry",
      "--process-definition-key",
      "invoice",
      "--dry-run",
      "--now",
    ])
    expect(JSON.parse(preview.stdout)).toMatchObject({
      plan: { mode: "definition", incidents: 1, jobs: 1, externalTasks: 0, skipped: [] },
      requests: [
        { summary: "set the retries of job job-1 to 1", method: "PUT" },
        { summary: "execute job job-1", method: "POST" },
      ],
    })
    const named = await cli(["retry", "--incident", "inc-1", "--retries", "2"])
    expect(JSON.parse(named.stdout)).toMatchObject({
      retried: 1,
      incidents: [{ action: "retries=2", result: "retried" }],
    })
    const mixed = await cli(["retry", "pi-1", "--incident", "inc-1"])
    expect(errorOf(mixed.stderr).message).toMatch(/^--incident excludes/)
    expect(errorOf((await cli(["retry", "pi-1", "--incident-type", "nope"])).stderr)).toMatchObject(
      { message: '--incident-type expects one of failedJob, failedExternalTask, got "nope"' },
    )
  })

  it("reports nothing to retry with zeros", async () => {
    const { cli } = setup()
    const result = await cli(["retry", "pi-1", "-o", "table"])
    expect(result.stdout).toBe(
      "No open incidents to retry.\nRetried 0, succeeded 0, failed 0, skipped 0, gone 0\n",
    )
  })
})

describe("pulse-cli deploy", () => {
  const files = {
    "bpmn/order.bpmn":
      '<bpmn:definitions><bpmn:process id="order" isExecutable="true"/></bpmn:definitions>',
    "bpmn/forms/approve.form": "{}",
    "bpmn/.git/x.bpmn": "<x/>",
  }

  it("deploys a directory once and reports unchanged resources afterwards", async () => {
    const { cli, engine } = setup("none", { files })
    const first = await cli(["deploy", "bpmn"])
    expect(first.code).toBe(0)
    expect(JSON.parse(first.stdout)).toMatchObject({
      name: "pulse-cli",
      changed: true,
      resources: [
        { resource: "forms/approve.form", status: "deployed", definitions: [] },
        {
          resource: "order.bpmn",
          status: "deployed",
          definitions: [{ type: "process", key: "order", version: 1 }],
        },
      ],
    })
    const form = engine.requests.find((request) => request.path === "/deployment/create")
      ?.body as FormData
    expect(form.get("deployment-source")).toBe("pulse-cli")
    expect(form.get("deploy-changed-only")).toBe("true")
    const second = await cli(["deploy", "bpmn", "-o", "table"])
    expect(second.stdout).toContain("(pulse-cli, unchanged)")
    expect(second.stdout).toContain("order.bpmn          unchanged  process  order  1")
  })

  it("starts an instance of the only process with --start", async () => {
    const { cli, engine } = setup("none", { files })
    const result = await cli([
      "deploy",
      "bpmn/order.bpmn",
      "--start",
      "--business-key",
      "B-2",
      "--var",
      "amount=250",
    ])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      instance: { id: "pi-1", businessKey: "B-2", waitingAt: [{ activityId: "approve" }] },
    })
    expect(engine.variables).toEqual({ amount: { value: 250, type: "Integer" } })
  })

  it("sends nothing with --dry-run and checks the start options", async () => {
    const { cli, engine } = setup("none", { files })
    const preview = await cli(["deploy", "bpmn", "--dry-run", "--start-key", "order"])
    expect(engine.requests).toEqual([])
    expect(JSON.parse(preview.stdout)).toMatchObject({
      plan: {
        name: "pulse-cli",
        resources: [
          { resource: "forms/approve.form", file: "bpmn/forms/approve.form" },
          { resource: "order.bpmn", file: "bpmn/order.bpmn" },
        ],
        start: { key: "order" },
      },
      requests: [{ summary: "deploy 2 resource(s) as pulse-cli", method: "POST" }],
    })
    expect(errorOf((await cli(["deploy", "bpmn", "--business-key", "B-1"])).stderr)).toMatchObject({
      message: "--business-key needs --start or --start-key",
    })
    expect(errorOf((await cli(["deploy", "missing"])).stderr)).toMatchObject({
      message: "File not found: missing",
    })
    expect(errorOf((await cli(["deploy", "bpmn", "--read-only"])).stderr)).toMatchObject({
      code: "READ_ONLY",
    })
  })
})

describe("pulse-cli status", () => {
  it("reports the incident group as a warning finding with the next command", async () => {
    const { cli } = setup("failed")
    const result = await cli(["status"])
    expect(result.code).toBe(0)
    const view = JSON.parse(result.stdout) as Record<string, unknown>
    expect(view).toMatchObject({
      engine: { url: ENGINE_URL, version: "7.24.0" },
      status: "warning",
      findings: [
        {
          severity: "warning",
          code: "INCIDENTS",
          next: "pulse-cli retry --process-definition-key invoice --activity-id book --dry-run",
        },
      ],
      incidents: [
        {
          processDefinitionKey: "invoice",
          activityId: "book",
          count: 1,
          rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
        },
      ],
      jobs: { executable: 0, overdue: 0 },
      tasks: { open: 0 },
      batches: { running: 0, withFailures: 0 },
    })
    const table = await cli(["status", "-o", "table"])
    expect(table.stdout).toMatch(
      /^Engine {2}http:\/\/localhost:8080\/engine-rest \(version 7\.24\.0, 0ms\)\nStatus {2}warning\n\nFindings:\n {2}warning {2}1 failedJob incident at invoice\/book: /,
    )
  })

  it("fails with CHECK_FAILED after printing the view when --fail-on is reached", async () => {
    const { cli } = setup("failed")
    const result = await cli(["status", "--fail-on", "warning", "--fields", "status"])
    expect(result.code).toBe(9)
    expect(result.stdout).toBe('{"status":"warning"}\n')
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CHECK_FAILED",
      message: "Engine status is warning (1 finding)",
    })
    expect((await cli(["status", "--fail-on", "critical"])).code).toBe(0)
    expect(errorOf((await cli(["status", "--fail-on", "never"])).stderr)).toMatchObject({
      code: "USAGE",
    })
  })

  it("previews round 1 with --dry-run", async () => {
    const { cli, engine } = setup()
    const result = await cli([
      "status",
      "--dry-run",
      "--process-definition-key",
      "a",
      "--process-definition-key",
      "b",
    ])
    expect(engine.requests).toEqual([])
    const urls = (JSON.parse(result.stdout) as { requests: { url: string }[] }).requests.map(
      (request) => new URL(request.url),
    )
    expect(urls.map((url) => url.pathname.replace("/engine-rest", ""))).toEqual([
      "/version",
      "/process-definition/statistics",
      "/incident",
      "/incident/count",
      "/external-task",
      "/external-task/count",
      "/job/count",
      "/job/count",
      "/job",
      "/job",
      "/task/count",
    ])
    expect(urls[2]?.searchParams.get("processDefinitionKeyIn")).toBe("a,b")
    expect(errorOf((await cli(["status", "--max-groups", "0"])).stderr)).toMatchObject({
      message: '--max-groups expects an integer between 1 and 100, got "0"',
    })
  })
})
