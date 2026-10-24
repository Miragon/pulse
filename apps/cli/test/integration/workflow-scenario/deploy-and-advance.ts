/**
 * The first half of the workflow scenario: deploy, start, inspect, advance step by step, wait and
 * fail fast on the incident of the job.
 */

import { join } from "node:path"
import { expect, it } from "vitest"
import { expectError, expectSuccess, required } from "../support/expect.js"
import type { DryRunOutput } from "../support/types.js"
import {
  type AdvanceOutput,
  BY_KEY,
  type DeployOutput,
  type InstanceOutput,
  type StatusOutput,
  type WorkflowScenario,
} from "./suite.js"

export function registerDeployAndAdvance(scenario: WorkflowScenario): void {
  const { cli, state, bpmnDir, inspect } = scenario

  it("deploys the directory once; a second deploy changes nothing", async () => {
    const first = expectSuccess(await cli(["deploy", bpmnDir()])).json<DeployOutput>()
    expect(first).toMatchObject({
      changed: true,
      resources: [{ resource: "workflow.bpmn", status: "deployed" }],
    })
    const keys = first.resources[0]?.definitions.map((definition) => [
      definition.key,
      definition.version,
    ])
    expect(keys).toEqual([
      ["workflow-child", 1],
      ["workflow-parent", 1],
    ])
    state.deploymentId = first.deploymentId

    const second = expectSuccess(await cli(["deploy", bpmnDir()])).json<DeployOutput>()
    expect(second).toMatchObject({
      deploymentId: first.deploymentId,
      changed: false,
      resources: [{ status: "unchanged" }],
    })
    expect(second.resources[0]?.definitions).toEqual(first.resources[0]?.definitions)
  })

  it("ignores another deployment's resource of the same name; --start refuses before deploying", async () => {
    const dir = scenario.workdir()
    expectSuccess(await cli(["deploy", join(dir, "other", "workflow.bpmn"), "--name", "team-b"]))
    const unchanged = expectSuccess(await cli(["deploy", bpmnDir()])).json<DeployOutput>()
    expect(unchanged.resources[0]?.definitions.map((definition) => definition.key)).toEqual([
      "workflow-child",
      "workflow-parent",
    ])
    const refused = expectError(await cli(["deploy", bpmnDir(), "--start"]), "USAGE", 2)
    expect(refused.message).toBe("The files contain 2 processes: workflow-child, workflow-parent")
    const after = expectSuccess(await cli(["deploy", bpmnDir()])).json<DeployOutput>()
    expect(after.deploymentId).toBe(state.deploymentId)
  })

  it("starts an instance that waits at the user task of the called instance", async () => {
    const result = await cli([
      "deploy",
      bpmnDir(),
      "--start-key",
      "workflow-parent",
      ...BY_KEY,
      "--var",
      "failBooking=true",
    ])
    const instance = required(
      expectSuccess(result).json<DeployOutput>().instance,
      "the started instance",
    )
    expect(instance.waitingAt).toEqual([
      expect.objectContaining({ activityId: "approve", kind: "userTask" }),
    ])
    expect(instance.children).toEqual([expect.objectContaining({ key: "workflow-child" })])
    expect(instance.waitingAt[0]?.processInstanceId).toBe(instance.children[0]?.id)
    state.instanceId = instance.id
  })

  it("inspects the instance as a table, also in read-only mode", async () => {
    const table = expectSuccess(await cli(["inspect", ...BY_KEY, "-o", "table", "--read-only"]))
    expect(table.stdout).toContain("\nWaiting at:\n")
    expect(table.stdout).toMatch(/\napprove +userTask /)
  })

  it("previews advance with --dry-run without completing the task; refuses it read-only", async () => {
    const preview = expectSuccess(await cli(["advance", ...BY_KEY, "--dry-run"])).json<{
      requests: (DryRunOutput & { summary: string })[]
    }>()
    expect(preview.requests).toHaveLength(1)
    expect(preview.requests[0]).toMatchObject({
      method: "POST",
      summary: expect.stringMatching(/^complete user task /),
    })
    expect(new URL(preview.requests[0]?.url ?? "").pathname).toMatch(/\/task\/[^/]+\/complete$/)
    expect((await inspect()).waitingAt[0]?.kind).toBe("userTask")
    expectError(await cli(["advance", ...BY_KEY, "--read-only"]), "READ_ONLY", 2)
  })

  it("completes the user task, then locks and completes the external task", async () => {
    const task = expectSuccess(
      await cli(["advance", ...BY_KEY, "--var", "approved=true"]),
    ).json<AdvanceOutput>()
    expect(task.advanced).toMatchObject({ activityId: "approve", kind: "userTask" })
    expect(task.instance?.waitingAt).toEqual([
      expect.objectContaining({ activityId: "charge", kind: "externalTask" }),
    ])

    // a reported failure with retries left waits for its retry: no "worker crashed"
    expectSuccess(
      await cli([
        "advance",
        ...BY_KEY,
        "--activity-id",
        "charge",
        "--fail",
        "PSP timeout",
        "--retries",
        "2",
      ]),
    )
    const status = expectSuccess(await cli(["status", "--stale-after", "1ms"])).json<StatusOutput>()
    expect(status.findings.map((finding) => finding.code)).not.toContain("LOCK_EXPIRED")
    expect(status.externalTasks).toContainEqual(
      expect.objectContaining({ topic: "workflow-charge", waiting: 1, lockExpired: 0 }),
    )

    const external = expectSuccess(
      await cli(["advance", ...BY_KEY, "--activity-id", "charge"]),
    ).json<AdvanceOutput>()
    expect(external.advanced.via).toEqual([
      expect.stringMatching(/^POST \/external-task\/[^/]+\/lock$/),
      expect.stringMatching(/^POST \/external-task\/[^/]+\/complete$/),
    ])
    expect(external.instance?.waitingAt).toEqual([
      expect.objectContaining({ activityId: "paid", kind: "message" }),
    ])
  })

  it("times out with exit code 9 and prints the view at the message", async () => {
    const result = await cli(["wait", ...BY_KEY, "--until", "task", "--wait-timeout", "1s"])
    expectError(result, "WAIT_TIMEOUT", 9)
    expect(result.json<InstanceOutput>().waitingAt).toEqual([
      expect.objectContaining({ activityId: "paid" }),
    ])
  })

  it("refuses a typo in --until at once, before any write, and knows the called process", async () => {
    const typo = expectError(
      await cli(["wait", ...BY_KEY, "--until", "activity:paidd"]),
      "USAGE",
      2,
    )
    expect(typo.message).toBe(
      "--until activity:paidd: no such element in the BPMN of workflow-parent, workflow-child",
    )
    expect(typo.hint).toMatch(/^Did you mean activity:paid\? /)
    const write = await cli(["advance", ...BY_KEY, "--until", "task:aprove"])
    expect(expectError(write, "USAGE", 2).hint).toMatch(/^Did you mean task:approve\? /)
    expect((await inspect()).waitingAt).toEqual([expect.objectContaining({ activityId: "paid" })])
    expectSuccess(
      await cli(["wait", ...BY_KEY, "--until", "activity:paid", "--wait-timeout", "5s"]),
    )
  })

  it("triggers the message, then fires the timer and fails fast on the incident of the job", async () => {
    const message = expectSuccess(await cli(["advance", ...BY_KEY])).json<AdvanceOutput>()
    expect(message.advanced.kind).toBe("message")
    expect(message.instance?.waitingAt).toEqual([
      expect.objectContaining({ activityId: "cool-down", kind: "timer" }),
    ])

    const timer = await cli(["advance", ...BY_KEY, "--wait"])
    expectError(timer, "INCIDENT", 9)
    const view = timer.json<AdvanceOutput>()
    expect(view.advanced.kind).toBe("timer")
    expect(view.instance?.incidents[0]).toMatchObject({ type: "failedJob", activityId: "book" })
    expect(view.instance?.incidents[0]?.rootCause).toContain("missingBean")
  })

  it("shows the stacktrace in the table and projects fields of the wait states", async () => {
    const table = expectSuccess(await cli(["inspect", ...BY_KEY, "--stacktrace", "-o", "table"]))
    expect(table.stdout).toContain("\nStacktrace (failedJob at book, incident ")
    expect(table.stdout).toMatch(/\n +at org\./)
    const projected = expectSuccess(
      await cli(["inspect", ...BY_KEY, "--fields", "waitingAt.activityId,waitingAt.kind"]),
    )
    expect(projected.json()).toEqual({
      waitingAt: [{ activityId: "book", kind: "asyncContinuation" }],
    })
    expect(projected.stderr).toBe("")
  })
}
