import { beforeEach, describe, expect, it, vi } from "vitest"
import { cibsevenProvider } from "../providers/index.js"

// Primary-read failures are the rejection table in `honest-numbers.test.ts`.
vi.mock("@miragon/pulse-camunda7-client/sdk", () => ({
  getActivityInstanceTree: vi.fn(),
  getIncidents: vi.fn(),
  getIncidentsCount: vi.fn(),
  getProcessDefinitionBpmn20Xml: vi.fn(),
  getProcessDefinitionByKey: vi.fn(),
  getProcessDefinitionStatistics: vi.fn(),
  getProcessInstance: vi.fn(),
  getProcessInstanceVariables: vi.fn(),
  getTasks: vi.fn(),
  getTasksCount: vi.fn(),
}))

vi.mock("../tools/task-form.js", () => ({ buildTaskFormSchema: vi.fn() }))

import {
  getActivityInstanceTree,
  getIncidents,
  getIncidentsCount,
  getProcessDefinitionBpmn20Xml,
  getProcessDefinitionStatistics,
  getProcessInstance,
  getProcessInstanceVariables,
  getTasks,
  getTasksCount,
} from "@miragon/pulse-camunda7-client/sdk"
import { buildTaskFormSchema } from "../tools/task-form.js"

import { buildInstanceDetailData } from "./instance-detail-data.js"

const mockedActivityTree = vi.mocked(getActivityInstanceTree)
const mockedIncidents = vi.mocked(getIncidents)
const mockedIncidentsCount = vi.mocked(getIncidentsCount)
const mockedBpmn = vi.mocked(getProcessDefinitionBpmn20Xml)
const mockedStatistics = vi.mocked(getProcessDefinitionStatistics)
const mockedInstance = vi.mocked(getProcessInstance)
const mockedVariables = vi.mocked(getProcessInstanceVariables)
const mockedTasks = vi.mocked(getTasks)
const mockedTasksCount = vi.mocked(getTasksCount)
const mockedFormSchema = vi.mocked(buildTaskFormSchema)

type FakeClient = Parameters<typeof buildInstanceDetailData>[0]
// A fresh client per test: the XML read is cached per engine client.
let fakeClient = {} as FakeClient

beforeEach(() => {
  fakeClient = {} as FakeClient
  vi.clearAllMocks()
})

describe("buildInstanceDetailData", () => {
  beforeEach(() => {
    mockedInstance.mockResolvedValue({ id: "p1", definitionId: "K1:3:dep" })
    mockedActivityTree.mockResolvedValue({
      activityId: "root",
      childActivityInstances: [{ activityId: "A1" }],
    })
    mockedVariables.mockResolvedValue({})
    mockedIncidents.mockResolvedValue([] as never)
    mockedTasks.mockResolvedValue([] as never)
    mockedIncidentsCount.mockResolvedValue({ count: 0 })
    mockedTasksCount.mockResolvedValue({ count: 0 })
    mockedBpmn.mockResolvedValue({ bpmn20Xml: "<xml/>" })
    mockedFormSchema.mockResolvedValue({ taskId: "t1", fields: [] })
  })

  it("collects the BPMN xml and the active + incident activity ids", async () => {
    mockedIncidents.mockResolvedValueOnce([
      { id: "i1", activityId: "A1", incidentType: "failedJob" },
    ] as never)

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(data.diagramDefinitionId).toBe("K1:3:dep")
    expect(data.activeActivityIds).toEqual(["root", "A1"])
    expect(data.incidentActivityIds).toEqual(["A1"])
    expect(data.engineId).toBe("engine-a")
    // A diagram without a named process element names none.
    expect(data.processDefinitionName).toBeNull()
  })

  it("names the process from its diagram and each incident row by the instance's business key", async () => {
    mockedInstance.mockResolvedValueOnce({
      id: "p1",
      definitionId: "K1:3:dep",
      businessKey: "LEA-2026-00424",
    })
    mockedBpmn.mockResolvedValueOnce({
      bpmn20Xml:
        '<definitions><process id="K1" name="Miravelo Bike Leasing"><task id="A1" name="Check"/></process></definitions>',
    })
    mockedIncidents.mockResolvedValueOnce([
      { id: "i1", processInstanceId: "p1", activityId: "A1", incidentType: "failedJob" },
    ] as never)

    const data = await buildInstanceDetailData(fakeClient, "engine-a", { processInstanceId: "p1" })

    expect(data.processDefinitionName).toBe("Miravelo Bike Leasing")
    expect(data.incidents.map((i) => i.businessKey)).toEqual(["LEA-2026-00424"])
  })

  // One rule with analytics (widget-shell `parseBpmnNames`): the Modeler
  // names the pool of a collaboration and writes a line break as `&#10;`.
  it("names a Modeler collaboration's process by its pool, the line break a space", async () => {
    mockedInstance.mockResolvedValueOnce({ id: "p1", definitionId: "K1:3:dep" })
    mockedBpmn.mockResolvedValueOnce({
      bpmn20Xml:
        '<definitions><collaboration id="C"><participant id="Pool" name="Miravelo -&#10;Bike Leasing" processRef="K1"/></collaboration><process id="K1"/></definitions>',
    })

    const data = await buildInstanceDetailData(fakeClient, "engine-a", { processInstanceId: "p1" })

    expect(data.processDefinitionName).toBe("Miravelo - Bike Leasing")
  })

  it("builds per-incident cockpit links when engine urls are supplied", async () => {
    mockedIncidents.mockResolvedValueOnce([
      { id: "i1", processInstanceId: "p1", incidentType: "failedJob" },
    ] as never)

    const data = await buildInstanceDetailData(
      fakeClient,
      "engine-a",
      { processInstanceId: "p1" },
      { baseUrl: "http://localhost:8080/engine-rest", provider: cibsevenProvider },
    )

    const [incident] = data.incidents
    expect(incident?.cockpitInstanceUrl).toContain("/process/K1/3/p1?tab=incidents")
    // An id that names its key needs no statistics.
    expect(mockedStatistics).not.toHaveBeenCalled()
  })

  describe("the cockpit links of a bare generated definition id", () => {
    // A key over ~25 characters with UUID ids: the engine stores a bare id,
    // and a key parsed from it is that UUID — a cockpit route no key matches.
    const LONG_KEY = "customerOnboardingApprovalProcess"
    const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const URLS = { baseUrl: "http://localhost:8080/engine-rest", provider: cibsevenProvider }

    beforeEach(() => {
      mockedInstance.mockResolvedValue({ id: "p1", definitionId: UUID })
    })
    const withOneIncident = () =>
      mockedIncidents.mockResolvedValueOnce([
        { id: "i1", processInstanceId: "p1", incidentType: "failedJob" },
      ] as never)

    it("address the key the statistics resolve — ONE read", async () => {
      withOneIncident()
      mockedStatistics.mockResolvedValueOnce([
        { id: UUID, instances: 1, incidents: [], definition: { id: UUID, key: LONG_KEY } },
      ] as never)

      const data = await buildInstanceDetailData(
        fakeClient,
        "engine-a",
        { processInstanceId: "p1" },
        URLS,
      )

      const url = data.incidents[0]?.cockpitInstanceUrl
      expect(url).toContain(`/process/${LONG_KEY}/p1?tab=incidents`)
      expect(url).not.toContain(UUID)
      expect(mockedStatistics).toHaveBeenCalledTimes(1)
    })

    it("are null when the statistics fail (enrichment) — never the UUID as a key", async () => {
      withOneIncident()
      mockedStatistics.mockRejectedValueOnce(new Error("boom"))

      const data = await buildInstanceDetailData(
        fakeClient,
        "engine-a",
        { processInstanceId: "p1" },
        URLS,
      )

      expect(data.incidents).toEqual([
        expect.objectContaining({ id: "i1", cockpitInstanceUrl: null }),
      ])
    })

    it("read no statistics without engine urls to build them from", async () => {
      withOneIncident()

      await buildInstanceDetailData(fakeClient, "engine-a", { processInstanceId: "p1" })

      expect(mockedStatistics).not.toHaveBeenCalled()
    })

    it("read no statistics for an instance without incidents — no link to build", async () => {
      const data = await buildInstanceDetailData(
        fakeClient,
        "engine-a",
        { processInstanceId: "p1" },
        URLS,
      )

      expect(data.incidents).toEqual([])
      expect(mockedStatistics).not.toHaveBeenCalled()
    })
  })

  it("leaves the cockpit link null without engine urls", async () => {
    mockedIncidents.mockResolvedValueOnce([{ id: "i1" }] as never)

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    // Missing fields fall back rather than shipping undefined into the widget.
    expect(data.incidents).toEqual([
      expect.objectContaining({
        cockpitInstanceUrl: null,
        processInstanceId: "p1",
        incidentType: "unknown",
        incidentMessage: null,
        incidentTimestamp: "",
      }),
    ])
  })

  it("degrades to a null xml when the BPMN fetch fails", async () => {
    mockedBpmn.mockRejectedValueOnce(new Error("boom"))

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(data.diagramDefinitionId).toBeNull()
  })

  it("skips the BPMN fetch entirely when the instance carries no definition id", async () => {
    mockedInstance.mockResolvedValueOnce({ id: "p1" })

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(mockedBpmn).not.toHaveBeenCalled()
    expect(data.diagramDefinitionId).toBeNull()
  })

  it("attaches a form schema per open task — null (never 'no form') when one fails", async () => {
    mockedTasks.mockResolvedValueOnce([
      { id: "t1", taskDefinitionKey: "Task_1", processDefinitionId: "K1:3:dep" },
      { id: "t2", taskDefinitionKey: "Task_2", processDefinitionId: "K1:3:dep" },
    ] as never)
    mockedFormSchema
      .mockResolvedValueOnce({ taskId: "t1", fields: [{ id: "amount" }] } as never)
      .mockRejectedValueOnce(new Error("no form"))

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(data.openTasks).toHaveLength(2)
    expect(data.openTasks[0].formSchema).toMatchObject({ taskId: "t1" })
    expect(data.openTasks[1].formSchema).toBeNull()
  })

  it("leaves the open tasks' forms unknown (null) when the BPMN cannot be read", async () => {
    // A 403/5xx on the diagram is not "no BPMN": a <camunda:formData> form
    // could be hiding there, and an empty schema would offer the task
    // without it. The widget loads the form itself and shows that error.
    mockedBpmn.mockRejectedValueOnce(new Error("403 not authorized"))
    mockedTasks.mockResolvedValueOnce([
      { id: "t1", taskDefinitionKey: "Task_1", processDefinitionId: "K1:3:dep" },
    ] as never)

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(data.openTasks[0].formSchema).toBeNull()
    expect(mockedFormSchema).not.toHaveBeenCalled()
  })

  it("builds the forms from 'no BPMN' only when the instance names no definition", async () => {
    mockedInstance.mockResolvedValueOnce({ id: "p1" })
    mockedTasks.mockResolvedValueOnce([{ id: "t1", taskDefinitionKey: "Task_1" }] as never)

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect(data.openTasks[0].formSchema).toEqual({ taskId: "t1", fields: [] })
    expect(mockedFormSchema).toHaveBeenCalledWith(fakeClient, "t1", {
      task: { id: "t1", taskDefinitionKey: "Task_1" },
      bpmnXml: null,
    })
  })

  it("reports the exact open incident and task totals from /count, not the capped lists", async () => {
    mockedIncidents.mockResolvedValueOnce([{ id: "i1", activityId: "A1" }] as never)
    mockedIncidentsCount.mockResolvedValueOnce({ count: 140 })
    mockedTasks.mockResolvedValueOnce([{ id: "t1" }] as never)
    mockedTasksCount.mockResolvedValueOnce({ count: 75 })
    mockedFormSchema.mockResolvedValue({ taskId: "t1", fields: [] })

    const data = await buildInstanceDetailData(fakeClient, "engine-a", {
      processInstanceId: "p1",
    })

    expect([data.incidents.length, data.incidentCount]).toEqual([1, 140])
    expect([data.openTasks.length, data.openTaskCount]).toEqual([1, 75])
    expect(mockedIncidentsCount.mock.calls[0]?.[0]?.query).toEqual({ processInstanceId: "p1" })
    expect(mockedTasksCount.mock.calls[0]?.[0]?.query).toEqual({ processInstanceId: "p1" })
  })

  it("fails — never '0 open incidents' — when the incident read fails", async () => {
    mockedIncidents.mockRejectedValueOnce(new Error("503"))

    await expect(
      buildInstanceDetailData(fakeClient, "engine-a", { processInstanceId: "p1" }),
    ).rejects.toThrow("503")
  })
})
