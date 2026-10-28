// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type { TaskFormSchema } from "../view-models.js"
import type { CompleteTaskArgs, TaskCompletion } from "./lib/complete-task.js"
import { useEngineAction } from "./lib/engine-action.js"
import { TaskCompleteForm } from "./task-complete-form.js"

// #328: a delegated task is resolved, not completed; a formRef is not "no form"; a null schema is
// loaded through camunda7_get_task_form, whose failure shows.

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const COMPLETE_ALLOWED = { allowedActions: ["camunda7_complete_task"] }

function renderForm(
  formSchema: TaskFormSchema | null,
  tools: Record<string, unknown>,
  onCompleted: () => void = () => {},
) {
  const Form: ComponentType<Record<string, unknown>> = () => {
    const complete = useEngineAction<CompleteTaskArgs, TaskCompletion>({
      tool: "camunda7_complete_task",
      target: (args) => args.taskId,
    })
    return (
      <TaskCompleteForm
        taskId="t-1"
        taskName="Approve invoice"
        engine="prod"
        formSchema={formSchema}
        action={complete}
        onCompleted={onCompleted}
      />
    )
  }
  render(
    <WidgetFixtureHost
      widget={Form}
      data={{}}
      tools={{ [CAMUNDA7_WIDGET_ACTIONS_DATA]: COMPLETE_ALLOWED, ...tools }}
    />,
  )
}

const NO_FIELDS: TaskFormSchema = { taskId: "t-1", fields: [] }

describe("the task form reports what the engine did", () => {
  it("a delegated task went back to its owner — shown as such, never as completed", async () => {
    let completed = 0
    renderForm(
      NO_FIELDS,
      {
        camunda7_complete_task: () => ({
          success: true,
          taskId: "t-1",
          outcome: "resolved",
          assignee: "mary",
        }),
      },
      () => completed++,
    )
    fireEvent.click(await screen.findByText("Complete task"))
    expect(await screen.findByText(/goes back to mary instead of being completed/)).toBeTruthy()
    expect(completed).toBe(0)
  })

  it("a completed task closes the form", async () => {
    let completed = 0
    renderForm(
      NO_FIELDS,
      { camunda7_complete_task: () => ({ success: true, taskId: "t-1", outcome: "completed" }) },
      () => completed++,
    )
    fireEvent.click(await screen.findByText("Complete task"))
    await waitFor(() => expect(completed).toBe(1))
    expect(screen.queryByText(/goes back to/)).toBeNull()
  })
})

describe("the task form never passes an unknown form for 'no form'", () => {
  it("names a linked Camunda Form (formRef)", async () => {
    renderForm({ ...NO_FIELDS, formRef: "invoiceForm" }, {})
    expect(await screen.findByText(/uses its own form \(invoiceForm\)/)).toBeTruthy()
    expect(screen.queryByText("This task has no form.")).toBeNull()
  })

  it("loads a schema the server could not build, and shows that load's failure", async () => {
    // The shared client retries with backoff: answer at once.
    queryClient.setQueryDefaults(["camunda7", "task-form"], { retry: false })
    const asked: unknown[] = []
    renderForm(null, {
      camunda7_get_task_form: (args: unknown) => {
        asked.push(args)
        throw new Error("[403] not authorized")
      },
    })
    expect(
      await screen.findByText(/Could not load the task form \(.*not authorized.*\)/),
    ).toBeTruthy()
    expect(asked).toEqual([{ taskId: "t-1", engine: "prod" }])
    expect(screen.queryByText("This task has no form.")).toBeNull()
  })
})

// "Ja"/"Nein" on screen, still a Boolean to the engine.
describe("a Boolean field speaks the view's language", () => {
  const APPROVED: TaskFormSchema = {
    taskId: "t-1",
    fields: [{ name: "approved", label: "Genehmigt", type: "Boolean", source: "form-data" }],
  }

  it.each([
    ["de", "Ja", "Nein", "Aufgabe abschließen"],
    ["en", "Yes", "No", "Complete task"],
  ] as const)("%s: %s / %s, and the engine gets a Boolean", async (locale, yes, no, complete) => {
    const submitted: unknown[] = []
    const Form: ComponentType<Record<string, unknown>> = () => {
      const action = useEngineAction<CompleteTaskArgs, TaskCompletion>({
        tool: "camunda7_complete_task",
        target: (args) => args.taskId,
      })
      return (
        <TaskCompleteForm
          taskId="t-1"
          taskName="Approve invoice"
          engine="prod"
          formSchema={APPROVED}
          action={action}
        />
      )
    }
    render(
      <LocaleProvider locale={locale}>
        <WidgetFixtureHost
          widget={Form}
          data={{}}
          tools={{
            [CAMUNDA7_WIDGET_ACTIONS_DATA]: COMPLETE_ALLOWED,
            camunda7_complete_task: (args: unknown) => {
              submitted.push(args)
              return { success: true, taskId: "t-1", outcome: "completed" }
            },
          }}
        />
      </LocaleProvider>,
    )
    const yesButton = await screen.findByRole("button", { name: yes })
    const noButton = screen.getByRole("button", { name: no })
    expect(screen.queryByText("true")).toBeNull()
    expect(screen.queryByText("false")).toBeNull()
    expect(yesButton.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(yesButton)
    expect(yesButton.getAttribute("aria-pressed")).toBe("true")
    expect(noButton.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(await screen.findByText(complete))
    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatchObject({
      variables: { approved: { value: true, type: "Boolean" } },
    })
  })
})
