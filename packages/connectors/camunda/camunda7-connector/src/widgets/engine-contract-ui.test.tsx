// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost, type HostActionLog } from "@miragon/mcp-toolkit-ui/app"
import { CAMUNDA7_WIDGET_ACTIONS, CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { IncidentInstance, VariableValue } from "../view-models.js"
import { IncidentsTab } from "./instance-detail/incidents-tab.js"
import { VariablesTable } from "./instance-sections.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"

/** #328: built-in incident types offer Retry; Json/Object values write back serialized; no Edit for binary. */

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const ALL_ACTIONS: { allowedActions: string[]; modelTools: string[] } = {
  allowedActions: [...CAMUNDA7_WIDGET_ACTIONS],
  modelTools: [],
}
// The hand-offs name what an admin deployment registers for the model.
beforeAll(async () => {
  ALL_ACTIONS.modelTools = (await widgetActionsFeedFor("admin")).modelTools
})

function incident(id: string, over: Partial<IncidentInstance>): IncidentInstance {
  return {
    id,
    processInstanceId: "pi-1",
    incidentType: "failedJob",
    incidentMessage: `message ${id}`,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    cockpitInstanceUrl: null,
    businessKey: null,
    recovery: { action: "none" },
    ...over,
  }
}

const INCIDENTS = [
  incident("job", { recovery: { action: "retry-job", jobId: "job-1" } }),
  incident("ext", {
    incidentType: "failedExternalTask",
    recovery: { action: "retry-external-task", externalTaskId: "ext-1" },
  }),
  incident("custom", { incidentType: "invoiceMismatch", recovery: { action: "resolve" } }),
  incident("propagated", {}),
]

const Incidents: ComponentType<Record<string, unknown>> = () => {
  const recovery = useIncidentRecovery("prod", { resetOn: INCIDENTS })
  return <IncidentTable incidents={INCIDENTS} recovery={recovery} onAnalyze={() => {}} />
}

function renderWidget(
  widget: ComponentType<Record<string, unknown>>,
  tools: Record<string, unknown>,
) {
  render(<WidgetFixtureHost widget={widget} data={{}} tools={tools} />)
}

/** The action button in the row that shows `message`. */
async function rowButtons(message: string) {
  const cell = await screen.findByText(message)
  const row = cell.closest("tr")!
  return [...row.querySelectorAll("button")].map((b) => b.textContent)
}

describe("incident rows offer the action the engine accepts", () => {
  it("Retry for failedJob and failedExternalTask, Resolve only for custom incidents", async () => {
    renderWidget(Incidents, { [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS })
    await waitFor(async () => expect(await rowButtons("message job")).toContain("Retry"))
    expect(await rowButtons("message job")).not.toContain("Mark as resolved")
    expect(await rowButtons("message ext")).toContain("Retry")
    expect(await rowButtons("message custom")).toContain("Mark as resolved")
    expect(await rowButtons("message custom")).not.toContain("Retry")
    const propagated = await rowButtons("message propagated")
    expect(propagated).not.toContain("Retry")
    expect(propagated).not.toContain("Mark as resolved")
  })

  it("Retry calls the matching retries tool with retries 1 on the row's engine", async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const record = (tool: string) => (args: Record<string, unknown>) => {
      calls.push([tool, args])
      return { success: true }
    }
    renderWidget(Incidents, {
      [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
      camunda7_set_job_retries: record("camunda7_set_job_retries"),
      camunda7_set_external_task_retries: record("camunda7_set_external_task_retries"),
    })
    const buttons = await screen.findAllByText("Retry")
    for (const button of buttons) fireEvent.click(button)
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls).toEqual(
      expect.arrayContaining([
        ["camunda7_set_job_retries", { jobId: "job-1", retries: 1, engine: "prod" }],
        [
          "camunda7_set_external_task_retries",
          { externalTaskId: "ext-1", retries: 1, engine: "prod" },
        ],
      ]),
    )
    expect(await screen.findAllByText("Retry scheduled")).toHaveLength(2)
  })

  it("keeps the row's ticket handoff on the instance's engine next to its recovery action", async () => {
    // Every Ask-AI hand-off carries the viewed engine as an id (#338); #328
    // swapped the rows' resolve props for `recovery`. The instance tab carries both.
    const actions: HostActionLog[] = []
    const OnProdB: ComponentType<Record<string, unknown>> = () => {
      const recovery = useIncidentRecovery("prod-b", { resetOn: INCIDENTS })
      return <IncidentsTab incidents={INCIDENTS} recovery={recovery} engine="prod-b" />
    }
    render(
      <WidgetFixtureHost
        widget={OnProdB}
        data={{}}
        tools={{ [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS }}
        onHostAction={(action) => actions.push(action)}
      />,
    )
    await waitFor(async () => expect(await rowButtons("message job")).toContain("Retry"))
    expect(await rowButtons("message custom")).toContain("Mark as resolved")
    const row = (await screen.findByText("message job")).closest("tr")!
    // The hand-off waits behind the row's "more" button (#322 U11).
    fireEvent.click(within(row).getByRole("button", { name: "More actions for this incident" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Draft ticket in chat" }))
    const prompts = actions
      .filter((a) => a.type === "sendFollowUpMessage")
      .map((a) => (a as { prompt: string }).prompt)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Ids: engine="prod-b", incidentId="job"')
    expect(prompts[0]).toContain("Tools: camunda7_format_incident_issue")
  })

  it("hides Retry when the toolset lacks the retries tool", async () => {
    renderWidget(Incidents, {
      [CAMUNDA7_WIDGET_ACTIONS_DATA]: { allowedActions: ["camunda7_resolve_incident"] },
    })
    await waitFor(async () =>
      expect(await rowButtons("message custom")).toContain("Mark as resolved"),
    )
    expect(screen.queryByText("Retry")).toBeNull()
  })
})

function variablesWidget(
  variables: Record<string, VariableValue>,
): ComponentType<Record<string, unknown>> {
  return () => <VariablesTable variables={variables} instanceId="pi-1" engine="prod" />
}

describe("the variable editor writes serialized values back", () => {
  const OBJECT_INFO = {
    objectTypeName: "java.util.ArrayList<java.lang.Integer>",
    serializationDataFormat: "application/json",
  }

  it("sends a Json/Object edit as the serialized string, with its valueInfo", async () => {
    const calls: Array<Record<string, unknown>> = []
    renderWidget(
      variablesWidget({ obj: { type: "Object", value: "[1,2]", valueInfo: OBJECT_INFO } }),
      {
        [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
        camunda7_set_process_instance_variable: (args: Record<string, unknown>) => {
          calls.push(args)
          return { success: true }
        },
      },
    )
    fireEvent.click(await screen.findByText("Edit"))
    const input = screen.getByDisplayValue("[1,2]")
    fireEvent.change(input, { target: { value: "[1,2,3]" } })
    fireEvent.click(screen.getByText("Save"))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      processInstanceId: "pi-1",
      variableName: "obj",
      value: "[1,2,3]",
      type: "Object",
      valueInfo: OBJECT_INFO,
      engine: "prod",
    })
  })

  it("refuses invalid JSON for a Json variable instead of sending it", async () => {
    renderWidget(variablesWidget({ payload: { type: "Json", value: '{"a":1}' } }), {
      [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS,
    })
    fireEvent.click(await screen.findByText("Edit"))
    fireEvent.change(screen.getByDisplayValue('{"a":1}'), { target: { value: "{a:" } })
    fireEvent.click(screen.getByText("Save"))
    expect(await screen.findByRole("alert")).toBeTruthy()
  })

  it("offers no Edit for binary or Java-serialized values", async () => {
    renderWidget(
      variablesWidget({
        file: { type: "File", value: null, valueInfo: { filename: "a.pdf" } },
        java: {
          type: "Object",
          value: "rO0AB",
          valueInfo: {
            ...OBJECT_INFO,
            serializationDataFormat: "application/x-java-serialized-object",
          },
        },
        text: { type: "String", value: "x" },
      }),
      { [CAMUNDA7_WIDGET_ACTIONS_DATA]: ALL_ACTIONS },
    )
    expect(await screen.findAllByText("Edit")).toHaveLength(1)
  })

  it("pretty-prints a serialized Json value", async () => {
    renderWidget(variablesWidget({ payload: { type: "Json", value: '{"a":1}' } }), {
      [CAMUNDA7_WIDGET_ACTIONS_DATA]: { allowedActions: [] },
    })
    expect(await screen.findByText(/"a": 1/)).toBeTruthy()
  })
})
