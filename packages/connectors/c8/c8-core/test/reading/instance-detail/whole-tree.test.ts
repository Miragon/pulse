import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { DETAIL_ROUTES } from "../../support/whole-tree.js"
import { detailWith, OPEN_USER_TASKS, searchesOf } from "../../support/instance-tree.js"

describe("the instance detail", () => {
  test("reads the whole tree of a running instance into one view", async () => {
    const { reader } = detailWith(DETAIL_ROUTES)

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.instance.hasIncident).toBe(true)
    expect(detail?.truncated).toBe(false)
    expect(
      detail?.path.map((run) => [run.elementId, run.canceled, run.endedAt !== undefined]),
    ).toEqual([
      ["Start", false, true],
      ["Skipped", true, true],
      ["Review", false, false],
      ["Call", false, false],
      ["Wait", false, false],
      ["Pay", false, false],
      ["Script", false, false],
      ["Odd", false, false],
    ])
    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        instanceId: "1",
        elementId: "Review",
        elementName: "Review name",
        kind: "userTask",
        assignee: "demo",
        dueAt: "2026-12-01T00:00:00.000Z",
      }),
      expect.objectContaining({ elementId: "Wait", kind: "timer" }),
      expect.objectContaining({
        elementId: "Pay",
        kind: "message",
        messageName: "Paid",
        correlationKey: "ORD-1",
      }),
      expect.objectContaining({
        elementId: "Script",
        kind: "workerTask",
        taskType: "script",
        retriesLeft: 2,
      }),
      expect.objectContaining({ elementId: "Odd", kind: "other", description: "MANUAL_TASK" }),
      expect.objectContaining({
        instanceId: "2",
        elementId: "Render",
        kind: "workerTask",
        taskType: "render-label",
        retriesLeft: 0,
        incidentId: "7",
      }),
    ])
    expect(detail?.calledInstances).toEqual([
      {
        id: "2",
        parentInstanceId: "1",
        bpmnProcessId: "label",
        tenantId: null,
        state: "running",
        calledFromElementId: "Call",
      },
    ])
    expect(detail?.incidents).toEqual([
      expect.objectContaining({
        id: "7",
        instanceId: "2",
        definition: {
          id: "300",
          bpmnProcessId: "label",
          tenantId: null,
          version: 3,
          name: "Label",
        },
        retriesLeft: 0,
        job: { id: "70", type: "render-label" },
      }),
    ])
    expect(detail?.variables).toEqual([
      {
        name: "route",
        scope: { kind: "instance" },
        valueJson: '"review"',
        truncated: false,
        kind: "string",
      },
      {
        name: "note",
        scope: { kind: "element", elementId: "Review" },
        valueJson: '"local"',
        truncated: false,
        kind: "string",
      },
      {
        name: "big",
        scope: { kind: "instance" },
        valueJson: '"cut',
        truncated: true,
        kind: "string",
      },
    ])
  })

  test("reads the history of the root only, and the waits of the active elements", async () => {
    const { camunda, reader } = detailWith(DETAIL_ROUTES)

    await reader.read(InstanceId("1"))

    const elementSearches = searchesOf(camunda, "POST /element-instances/search")
    expect(elementSearches).toHaveLength(3)
    expect(elementSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { processInstanceKey: "1" },
          sort: [
            { field: "startDate", order: "DESC" },
            { field: "elementInstanceKey", order: "DESC" },
          ],
        }),
        expect.objectContaining({
          filter: { processInstanceKey: "1", state: "ACTIVE" },
          sort: [
            { field: "startDate", order: "ASC" },
            { field: "elementInstanceKey", order: "ASC" },
          ],
        }),
        expect.objectContaining({ filter: { processInstanceKey: "2", state: "ACTIVE" } }),
      ]),
    )
    const jobSearches = searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)
    expect(jobSearches).toHaveLength(2)
    expect(jobSearches).toEqual(
      expect.arrayContaining([
        {
          processInstanceKey: "1",
          elementInstanceKey: { $in: ["1", "12", "13", "14", "15", "16", "17", "18"] },
        },
        { processInstanceKey: "2", elementInstanceKey: { $in: ["2", "20"] } },
      ]),
    )
    expect(searchesOf(camunda, "POST /user-tasks/search").map((search) => search.filter)).toEqual(
      expect.arrayContaining([
        { processInstanceKey: "1", state: { $in: OPEN_USER_TASKS } },
        { processInstanceKey: "2", state: { $in: OPEN_USER_TASKS } },
      ]),
    )
    expect(
      searchesOf(camunda, "POST /message-subscriptions/search").map((search) => search.filter),
    ).toEqual(
      expect.arrayContaining([
        { processInstanceKey: "1", messageSubscriptionState: { $in: ["CREATED", "MIGRATED"] } },
        { processInstanceKey: "2", messageSubscriptionState: { $in: ["CREATED", "MIGRATED"] } },
      ]),
    )
  })
})
