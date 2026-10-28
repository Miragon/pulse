// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { CAMUNDA7_INSTANCE_DETAIL_DATA } from "../tool-names.js"
import {
  FAILED_JOB_INCIDENT,
  Standalone,
  completeTheOpenTask,
  confirmIn,
  installWritePathHarness,
  instance,
  openTab,
  recorder,
  renderInstance,
  type Calls,
} from "./write-path.test-support.js"

// #341 / N99: writes only where the CURRENT state allows (the engine refuses completion on a suspended
// instance); an editor opened before the state changed closes instead of keeping a Save.

installWritePathHarness()

describe("the instance view offers only what its CURRENT state allows (N99)", () => {
  it("a suspended instance offers no task completion — the engine refuses one", async () => {
    renderInstance(
      Standalone,
      instance({ instance: { ...instance().instance, suspended: true } }),
      {},
    )
    expect(await screen.findByRole("button", { name: "Activate" })).toBeTruthy()
    expect(screen.getByText("Review invoice")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull()
  })

  it("suspending from the header withdraws the task completion at once", async () => {
    renderInstance(Standalone, instance(), {
      camunda7_set_process_instance_suspension: () => ({ success: true }),
      // The refetch is still out: the suspension's own success must decide.
      [CAMUNDA7_INSTANCE_DETAIL_DATA]: () => new Promise(() => {}),
    })
    expect(await screen.findByRole("button", { name: "Complete" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }))
    await confirmIn("Suspend instance")
    expect(await screen.findByRole("button", { name: "Activate" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull()
  })

  it("a cancelled instance offers no incident remedy", async () => {
    renderInstance(
      Standalone,
      instance({
        incidents: [FAILED_JOB_INCIDENT],
        incidentCount: 1,
        openTasks: [],
        openTaskCount: 0,
      }),
      { camunda7_delete_process_instance: () => ({ success: true }) },
    )
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel instance" }))
    await confirmIn("Cancel instance")
    expect(screen.getByText("Card declined")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("an unconfirmed state offers no incident remedy", async () => {
    renderInstance(Standalone, instance({ incidents: [FAILED_JOB_INCIDENT], incidentCount: 1 }), {
      camunda7_complete_task: () => ({ success: true, outcome: "completed" }),
      [CAMUNDA7_INSTANCE_DETAIL_DATA]: () => {
        throw new Error("Process instance with id pi-1 does not exist")
      },
    })
    await completeTheOpenTask()
    expect(await screen.findByText(/pi-1 does not exist/)).toBeTruthy()
    openTab(/^Incidents/)
    expect(await screen.findByText("Card declined")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("an open variable editor closes when the instance is cancelled — its Save cannot write", async () => {
    const calls: Calls = []
    renderInstance(Standalone, instance({ openTasks: [], openTaskCount: 0 }), {
      ...recorder(calls, "camunda7_delete_process_instance", () => ({ success: true })),
      ...recorder(calls, "camunda7_set_process_instance_variable", () => ({ success: true })),
    })
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Cancel instance" }))
    await confirmIn("Cancel instance")

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
    expect(calls.map(([name]) => name)).toEqual(["camunda7_delete_process_instance"])
  })
})
