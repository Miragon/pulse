// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import {
  createTestQueryClient,
  TestViewHost,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import { NOTES_LIST_DATA, NOTES_SHOW_NOTES } from "../tool-names.js"
import type { NotesListData } from "../notes-store.js"
import { NotesListWidget } from "./notes-list.js"
import { notesViews } from "./views.js"

afterEach(cleanup)

const DATA: NotesListData = {
  title: "Team Notes",
  query: null,
  notes: [
    {
      id: "n-1",
      title: "Retry policy for the payment gateway",
      text: "External task workers retry 3x with backoff.",
      tags: ["operations", "payments"],
      updatedAt: "2026-07-28T09:15:00Z",
    },
  ],
}

/**
 * The reference for a widget test: `TestViewHost` stands in for the chat host (fake tools, a log
 * of what the widget asked the host, the model context it reported), so no `bootstrapView` and
 * no server are needed.
 */
describe("the notes view", () => {
  it("renders the show tool's data without a call and tells the model what it shows", async () => {
    const actions: HostAction[] = []
    const contexts: string[] = []
    const View = notesViews[NOTES_SHOW_NOTES]
    render(
      <TestViewHost
        locale="en"
        onHostAction={(action) => actions.push(action)}
        onModelContext={(text) => contexts.push(text)}
      >
        <View data={DATA as never} />
      </TestViewHost>,
    )
    expect(screen.getByRole("heading", { name: "Team Notes" })).toBeTruthy()
    expect(screen.getByText("Retry policy for the payment gateway")).toBeTruthy()
    await waitFor(() => expect(contexts.at(-1)).toContain("1 note(s)"))
    expect(actions).toEqual([])
  })

  it("re-reads its feed with the filter it was shown with when the entry is invalidated", async () => {
    const client = createTestQueryClient()
    const actions: HostAction[] = []
    const filtered = { ...DATA, query: "retry" }
    render(
      <TestViewHost
        locale="en"
        client={client}
        tools={{ [NOTES_LIST_DATA]: filtered }}
        onHostAction={(action) => actions.push(action)}
      >
        <NotesListWidget data={filtered} />
      </TestViewHost>,
    )
    await act(() => client.invalidateQueries({ queryKey: ["notes:list"] }))
    expect(actions).toEqual([{ type: "callTool", name: NOTES_LIST_DATA, args: { query: "retry" } }])
  })

  it("fetches the feed itself when mounted without data, with a retry when it fails", async () => {
    let fail = true
    render(
      <TestViewHost
        locale="en"
        tools={{
          [NOTES_LIST_DATA]: () => {
            if (fail) throw new Error("store unreachable")
            return DATA
          },
        }}
      >
        <NotesListWidget data={null} />
      </TestViewHost>,
    )
    const retry = await screen.findByRole("button", { name: "Try again" })
    fail = false
    act(() => retry.click())
    expect(await screen.findByText("Retry policy for the payment gateway")).toBeTruthy()
  })
})
