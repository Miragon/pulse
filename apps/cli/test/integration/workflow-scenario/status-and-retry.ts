/**
 * The second half of the workflow scenario: status, retry, the receive task, the timeline, batches,
 * an unknown instance, an instance that ends after the write and a suspended job definition.
 */

import { copyFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { argv } from "../support/catalog.js"
import { expectError, expectExit, expectSuccess, required } from "../support/expect.js"
import { FIXTURES } from "../support/fixtures.js"
import {
  type AdvanceOutput,
  BY_KEY,
  type InstanceOutput,
  type StatusOutput,
  type WorkflowScenario,
} from "./suite.js"

export function registerStatusAndRetry(scenario: WorkflowScenario): void {
  const { cli, state, inspect } = scenario

  it("reports the incident group in status and fails CI with --fail-on warning", async () => {
    const status = expectSuccess(await cli(["status"])).json<{
      findings: { code: string; message: string; next?: string }[]
    }>()
    const finding = status.findings.find(
      (entry) => entry.code === "INCIDENTS" && entry.message.includes("workflow-parent/book"),
    )
    expect(finding?.message).toContain("missingBean")
    expect(finding?.next).toBe(
      "operate retry --process-definition-key workflow-parent --activity-id book --dry-run",
    )
    expectError(await cli(["status", "--fail-on", "warning"]), "CHECK_FAILED", 9)
  })

  it("retries the job after fixing the cause, then waits at the receive task", async () => {
    const id = required(state.instanceId, "instanceId")
    expectSuccess(
      await cli(argv("process-instance set-variable", [id, "failBooking"], { value: "false" })),
    )
    const retried = expectSuccess(await cli(["retry", ...BY_KEY, "--now"])).json<{
      incidents: { result: string }[]
    }>()
    expect(retried.incidents).toEqual([expect.objectContaining({ result: "succeeded" })])
    expect((await inspect()).waitingAt).toEqual([
      expect.objectContaining({
        activityId: "wait-signal",
        kind: "other",
        activityType: "receiveTask",
      }),
    ])
  })

  it("signals the receive task and shows the timeline of the completed instance", async () => {
    const done = expectSuccess(await cli(["advance", ...BY_KEY])).json<AdvanceOutput>()
    expect(done.instance?.state).toBe("COMPLETED")
    const history = await inspect("--history")
    expect(history.timeline?.map((entry) => entry.activityId)).toEqual([
      "start",
      "call-approval",
      "charge",
      "paid",
      "cool-down",
      "book",
      "wait-signal",
      "end",
    ])
  })

  it("needs --yes to retry a whole definition and previews an empty plan", async () => {
    expectError(
      await cli(["retry", "--process-definition-key", "workflow-parent"]),
      "CONFIRMATION_REQUIRED",
      2,
    )
    const preview = expectSuccess(
      await cli(["retry", "--process-definition-key", "workflow-parent", "--dry-run"]),
    ).json<{ plan: unknown; requests: unknown[] }>()
    expect(preview).toEqual({
      plan: { mode: "definition", incidents: 0, jobs: 0, externalTasks: 0, skipped: [] },
      requests: [],
    })
  })

  it("waits for a deletion batch", async () => {
    expectSuccess(
      await cli(argv("process-definition start", ["workflow-parent"], { businessKey: "WF-2" })),
    )
    const batch = expectSuccess(
      await cli(
        argv("process-instance delete-async", [], {
          body: JSON.stringify({ processInstanceQuery: { businessKey: "WF-2" } }),
          yes: true,
        }),
      ),
    ).json<{ id: string }>()
    const waited = expectSuccess(
      await cli(["wait", "--batch", batch.id, "--wait-timeout", "2m"], { timeoutMs: 180_000 }),
    )
    expect(waited.json<{ batch: { id: string; endTime?: string } }>().batch).toMatchObject({
      id: batch.id,
      endTime: expect.any(String),
    })
  }, 180_000)

  it("reports an unknown instance with exit code 5, also to retry", async () => {
    expectExit(await cli(["inspect", "00000000-0000-0000-0000-000000000000"]), 5)
    expectError(await cli(["retry", "00000000-0000-0000-0000-000000000000"]), "NOT_FOUND", 5)
  })

  it("reports advance when the instance ends right after the write (async continuation)", async () => {
    const edges = join(scenario.workdir(), "edges")
    await mkdir(edges)
    await copyFile(FIXTURES.workflowEdges, join(edges, "edges.bpmn"))
    expectSuccess(await cli(["deploy", edges, "--name", "edges"]))
    for (let run = 0; run < 5; run++) {
      const started = expectSuccess(
        await cli(argv("process-definition start", ["race-end"], {})),
      ).json<{ id: string }>()
      const advanced = expectSuccess(
        await cli(["advance", started.id, "--no-variables"]),
      ).json<AdvanceOutput>()
      expect(advanced.advanced).toMatchObject({ activityId: "review", kind: "userTask" })
      expect(["ACTIVE", "COMPLETED", "ENDED"]).toContain(advanced.instance?.state)
    }
  })

  it("treats the job of a suspended job definition as resting, never executes it", async () => {
    expectSuccess(
      await cli(
        argv("job-definition update-suspension-state", [], {
          processDefinitionKey: "paused",
          suspended: true,
          includeJobs: true,
          yes: true,
        }),
      ),
    )
    const started = expectSuccess(
      await cli(argv("process-definition start", ["paused"], {})),
    ).json<{ id: string }>()
    const view = expectSuccess(await cli(["inspect", started.id])).json<InstanceOutput>()
    expect(view.waitingAt).toEqual([
      expect.objectContaining({ activityId: "work", kind: "asyncContinuation", suspended: true }),
    ])
    expect(view.next ?? []).not.toContain(`operate advance ${started.id}`)
    expectSuccess(await cli(["wait", started.id, "--wait-timeout", "5s"]))
    expectError(
      await cli(["wait", started.id, "--execute-jobs", "--until", "task", "--wait-timeout", "2s"]),
      "WAIT_TIMEOUT",
      9,
    )
    expectError(await cli(["advance", started.id]), "USAGE", 2)
    const after = expectSuccess(await cli(["inspect", started.id])).json<InstanceOutput>()
    expect(after.waitingAt[0]).toMatchObject({ activityId: "work", suspended: true })
    const status = expectSuccess(
      await cli(["status", "--process-definition-key", "paused", "--stale-after", "1ms"]),
    ).json<StatusOutput>()
    expect(status.findings.map((finding) => finding.code)).not.toContain("JOBS_OVERDUE")
  })
}
