/**
 * The instance view of an ended instance as `pulse-cli inspect` prints it: its next step as a
 * command line. The view's fallbacks and defaults are engine-core's (its snapshot-edges.test.ts).
 */

import { describe, expect, it } from "vitest"
import type { InstanceData } from "@miragon/pulse-engine-core"
import { instanceView as viewOf } from "@miragon/pulse-engine-core/testing"
import { cliView } from "./inspect.js"

const instanceView = (data: InstanceData) => cliView(viewOf(data))

function data(overrides: Partial<InstanceData>): InstanceData {
  return {
    id: "pi",
    tree: [{ id: "pi", definitionId: "d", suspended: false, depth: 0 }],
    truncated: false,
    activityTrees: [],
    incidents: [],
    subscriptions: [],
    tasks: [],
    externalTasks: [],
    jobs: [],
    timerJobIds: new Set(),
    definitions: [],
    jobDefinitions: [],
    causes: new Map(),
    historyRequested: false,
    ...overrides,
  }
}

describe("instanceView with history", () => {
  it("reads the definition and the times of the history record", () => {
    const view = instanceView(
      data({
        parentId: "ignored",
        history: {
          processDefinitionId: "order:2:x",
          businessKey: "H",
          startTime: "s",
          endTime: "e",
          durationInMillis: 5,
          deleteReason: "gone",
          superProcessInstanceId: "parent",
          rootProcessInstanceId: "root",
          state: "EXTERNALLY_TERMINATED",
        },
      }),
    )
    expect(view).toEqual({
      id: "pi",
      businessKey: "H",
      definition: { key: "order", id: "order:2:x" },
      state: "EXTERNALLY_TERMINATED",
      startTime: "s",
      endTime: "e",
      durationMs: 5,
      deleteReason: "gone",
      parentId: "parent",
      rootId: "root",
      waitingAt: [],
      incidents: [],
      children: [],
      next: ["pulse-cli inspect pi --history"],
    })
    expect(
      instanceView(
        data({
          history: {
            processDefinitionId: "order:2:x",
            processDefinitionKey: "k",
            processDefinitionVersion: 2,
            processDefinitionName: "N",
            rootProcessInstanceId: "pi",
          },
        }),
      ),
    ).toMatchObject({ definition: { key: "k", version: 2, name: "N", id: "order:2:x" } })
    const ended = instanceView(data({ history: {} }))
    expect(ended.state).toBe("COMPLETED")
    expect(ended.definition).toEqual({ key: "", id: "" })
  })
})
