// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import {
  TestViewHost,
  useQueryClient,
  WebApiError,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import { useEngineList } from "../src/engine-list.js"

/**
 * The frame's one read of the engine list (src/engine-list.ts): a screen that mounts beside the
 * navigation reads it again where it went stale, never where its last read met a refusal no retry
 * changes (a page's ended session), so each refused read is asked once.
 */

afterEach(cleanup)

const LIST = { engines: [{ id: "prod", dialect: "c7" }] }

/** One reader of the list, as the navigation or a screen is. */
function Reader({ name }: { name: string }) {
  const { data, error } = useEngineList()
  return <p data-testid={name}>{error === null ? String(data?.engines?.length ?? "") : "failed"}</p>
}

/** The navigation's reader, which reads the list again and marks it stale; then a screen mounts. */
function Page() {
  const client = useQueryClient()
  const list = useEngineList()
  const [screenShown, setScreenShown] = useState(false)
  return (
    <>
      <button type="button" onClick={() => void list.refetch()}>
        Refresh
      </button>
      <button
        type="button"
        onClick={() => {
          void client.invalidateQueries({ queryKey: ["engine:engines"], refetchType: "none" })
          setScreenShown(true)
        }}
      >
        Open
      </button>
      <Reader name="navigation" />
      {screenShown && <Reader name="screen" />}
    </>
  )
}

function renderPage(second: () => unknown) {
  const actions: HostAction[] = []
  let calls = 0
  render(
    <TestViewHost
      tools={{ engine_list_engines: () => (calls++ === 0 ? LIST : second()) }}
      onHostAction={(action) => actions.push(action)}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <Page />
    </TestViewHost>,
  )
  return { reads: () => actions.filter((action) => action.type === "callTool").length }
}

async function refreshThenOpen() {
  await waitFor(() => expect(screen.getByTestId("navigation").textContent).toBe("1"))
  await act(async () => screen.getByRole("button", { name: "Refresh" }).click())
  await waitFor(() => expect(screen.getByTestId("navigation").textContent).toBe("failed"))
  await act(async () => screen.getByRole("button", { name: "Open" }).click())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe("the frame's read of the engine list", () => {
  it("is not read again by a screen that mounts after a read met the page's ended session", async () => {
    const { reads } = renderPage(() => {
      throw new WebApiError(401, { code: "signed_out", message: "No session." })
    })
    await refreshThenOpen()
    expect(reads()).toBe(2)
  })

  it("is read again by a screen that mounts after a read failed for a reason a retry may change", async () => {
    const { reads } = renderPage(() => ({
      isError: true,
      content: [{ type: "text", text: "[unreachable] the server is away" }],
    }))
    await refreshThenOpen()
    await waitFor(() => expect(reads()).toBe(3))
  })
})
