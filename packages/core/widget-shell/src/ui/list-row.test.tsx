// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { LocaleProvider, Td, ToastProvider } from "@miragon/pulse-ui"
import { ListRow } from "./list-row.js"
import { ListTable } from "./list-table.js"

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false })
})

afterEach(cleanup)

function Instances({
  onOpen = vi.fn(),
  locale = "en",
  href,
}: {
  onOpen?: (id: string) => void
  locale?: string
  /** The first row's address, as a page with addresses links it. */
  href?: string
}) {
  return (
    <LocaleProvider locale={locale}>
      <ToastProvider>
        <ListTable ariaLabel="Instances" columns={[{ label: "Instance" }, { label: "Actions" }]}>
          <ListRow label="Instance ORD-1" onOpen={() => onOpen("i-1")} href={href} copy="i-1">
            <Td>ORD-1</Td>
            <Td>
              <button type="button">Retry ORD-1</button>
            </Td>
          </ListRow>
          <ListRow label="Instance ORD-2">
            <Td>ORD-2</Td>
            <Td />
          </ListRow>
        </ListTable>
      </ToastProvider>
    </LocaleProvider>
  )
}

describe("ListRow: a row opens on a click or Enter (one row convention)", () => {
  it("opens on a click or Enter, never through a control at the row's end", () => {
    const onOpen = vi.fn()
    render(<Instances onOpen={onOpen} />)
    const row = screen.getByRole("row", { name: "Instance ORD-1" })
    expect(row.getAttribute("tabindex")).toBe("0")
    fireEvent.click(within(row).getByText("ORD-1"))
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.click(within(row).getByRole("button", { name: "Retry ORD-1" }))
    expect(onOpen.mock.calls).toEqual([["i-1"], ["i-1"]])
  })

  it("links to what it opens on a page: a new tab with Ctrl or Cmd or a middle click, in place else", () => {
    const onOpen = vi.fn()
    const opened = vi.spyOn(window, "open").mockReturnValue(null)
    render(<Instances onOpen={onOpen} href="/app/engines/prod/instances/i-1" />)
    const row = screen.getByRole("row", { name: "Instance ORD-1" })
    fireEvent.click(within(row).getByText("ORD-1"))
    fireEvent.click(within(row).getByText("ORD-1"), { ctrlKey: true })
    fireEvent.keyDown(row, { key: "Enter", metaKey: true })
    fireEvent(row, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))
    expect(onOpen.mock.calls).toEqual([["i-1"]])
    expect(opened.mock.calls.map(([url]) => url)).toEqual([
      "/app/engines/prod/instances/i-1",
      "/app/engines/prod/instances/i-1",
      "/app/engines/prod/instances/i-1",
    ])
    opened.mockRestore()
  })

  it("is a plain row without onOpen: no name, no tab stop, a click opens nothing", () => {
    render(<Instances />)
    const plain = screen.getByText("ORD-2").closest("tr")
    expect(plain?.hasAttribute("aria-label")).toBe(false)
    expect(plain?.hasAttribute("tabindex")).toBe(false)
  })

  it("copies its id on Ctrl or Cmd with C and says so", async () => {
    render(<Instances />)
    fireEvent.keyDown(screen.getByRole("row", { name: "Instance ORD-1" }), {
      key: "c",
      ctrlKey: true,
    })
    expect(await screen.findByText("ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("i-1")
  })

  it("says how to copy it by hand where the frame may not copy, in the active locale", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    render(<Instances locale="de" />)
    fireEvent.keyDown(screen.getByRole("row", { name: "Instance ORD-1" }), {
      key: "c",
      metaKey: true,
    })
    expect(await screen.findByText("Die ID ließ sich nicht kopieren")).toBeTruthy()
    // The row shows its id short: the hint sends the reader to the view, which shows it whole.
    expect(screen.getByText("Öffne die Zeile und kopier sie aus ihrer Ansicht.")).toBeTruthy()
  })

  it("names what it copies where that is no id, in its toast and the table's hint", async () => {
    render(
      <LocaleProvider locale="en">
        <ToastProvider>
          <ListTable
            ariaLabel="Incidents"
            columns={[{ label: "Message" }]}
            copyHint="Enter opens the row, Ctrl or Cmd+C copies its incident message."
          >
            <ListRow
              label="Instance 81a2e0b4"
              onOpen={vi.fn()}
              copy="Card declined"
              copyLabel="Incident message"
            >
              <Td>Card declined</Td>
            </ListRow>
          </ListTable>
        </ToastProvider>
      </LocaleProvider>,
    )
    const row = screen.getByRole("row", { name: "Instance 81a2e0b4" })
    expect(document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Enter opens the row, Ctrl or Cmd+C copies its incident message.",
    )
    fireEvent.keyDown(row, { key: "c", ctrlKey: true })
    expect(await screen.findByText("Incident message copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("Card declined")
    writeText.mockRejectedValue(new Error("denied"))
    fireEvent.keyDown(row, { key: "c", ctrlKey: true })
    expect(await screen.findByText("Incident message not copied")).toBeTruthy()
  })

  it("leaves Ctrl or Cmd with C to the browser where the reader selected text in the row", () => {
    render(<Instances />)
    const row = screen.getByRole("row", { name: "Instance ORD-1" })
    window.getSelection()?.selectAllChildren(within(row).getByText("ORD-1"))
    expect(fireEvent.keyDown(row, { key: "c", ctrlKey: true })).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText("ID copied")).toBeNull()
    window.getSelection()?.removeAllRanges()
  })
})
