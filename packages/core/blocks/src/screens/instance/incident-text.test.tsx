// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import { afterEach, describe, expect, it, vi } from "vitest"
import { IncidentText, type IncidentTextProps, type IncidentTextRead } from "./incident-text.js"
import { editorInstanceSlots } from "./instance-slots.test-support.js"

afterEach(cleanup)

const TRACE = [
  'org.springframework.web.client.ResourceAccessException: I/O error on POST "https://scoring.internal/score"',
  "Caused by: java.net.ConnectException: Connection refused",
  "\tat java.base/sun.nio.ch.Net.connect0(Native Method)",
].join("\n")

const READ: IncidentTextRead = { status: "read", text: TRACE, truncated: false, rootCauseLine: 1 }

/** A wrapper whose message repeats its cause's, as Java's `Throwable(cause)` writes it. */
const WRAPPED = [
  "org.camunda.bpm.engine.ProcessEngineException: java.lang.NullPointerException",
  "\tat org.camunda.bpm.engine.impl.Service.run(Service.java:42)",
  "Caused by: java.lang.NullPointerException",
  "\tat com.example.Scoring.call(Scoring.java:7)",
].join("\r\n")

function textOf(props: Partial<IncidentTextProps> = {}, locale = "en") {
  const { slots, asked } = editorInstanceSlots()
  const onRead = vi.fn<() => void>()
  const view = render(
    <LocaleProvider locale={locale}>
      <IncidentText kind="stacktrace" onRead={onRead} slots={slots} {...props} />
    </LocaleProvider>,
  )
  return { region: within(view.container), container: view.container, onRead, asked, view }
}

describe("an incident's text", () => {
  it("reads nothing until the reader opens it, then asks for it once", () => {
    const { region, onRead } = textOf()

    expect(onRead).not.toHaveBeenCalled()
    fireEvent.click(region.getByRole("button", { name: "Show stacktrace" }))

    expect(onRead).toHaveBeenCalledTimes(1)
    expect(region.getByRole("status").textContent).toBe("Reading the text…")
    fireEvent.click(region.getByRole("button", { name: "Hide stacktrace" }))
    expect(region.queryByRole("status")).toBeNull()
    fireEvent.click(region.getByRole("button", { name: "Show stacktrace" }))
    expect(onRead).toHaveBeenCalledTimes(1)
  })

  it("marks the line its root cause stands on, copies the whole text and wraps it on request", () => {
    const { region, container, asked } = textOf({ defaultOpen: true, read: READ })
    const text = container.querySelector<HTMLElement>('[data-part="incident-text"]')

    expect(container.querySelector('[data-part="root-cause-line"]')?.textContent).toBe(
      "Caused by: java.net.ConnectException: Connection refused ← Root cause",
    )
    expect(text?.className).toContain("whitespace-pre")
    fireEvent.click(region.getByRole("button", { name: "Copy stacktrace" }))
    fireEvent.click(region.getByRole("button", { name: "Wrap lines" }))

    expect(asked.copied).toEqual([{ text: TRACE, label: "stacktrace" }])
    expect(region.getByRole("button", { name: "Wrap lines" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(text?.className).toContain("whitespace-pre-wrap")
    expect(region.queryByText("The engine cut this text off.")).toBeNull()
  })

  it("marks the line the read names, never a line that repeats its cause, at the contract's breaks", () => {
    const { container } = textOf({
      defaultOpen: true,
      read: { status: "read", text: WRAPPED, truncated: false, rootCauseLine: 2 },
    })
    const lines = [...container.querySelectorAll('[data-part="incident-text"] > span')]

    expect(lines.map((line) => line.textContent)).toEqual([
      "org.camunda.bpm.engine.ProcessEngineException: java.lang.NullPointerException",
      "\tat org.camunda.bpm.engine.impl.Service.run(Service.java:42)",
      "Caused by: java.lang.NullPointerException ← Root cause",
      "\tat com.example.Scoring.call(Scoring.java:7)",
    ])
    expect(container.querySelectorAll('[data-part="root-cause-line"]')).toHaveLength(1)
  })

  it("marks no line where the read names none, and says a cut", () => {
    const { container } = textOf({
      kind: "errorMessage",
      defaultOpen: true,
      read: { status: "read", text: "Worker failed", truncated: true },
    })

    expect(container.querySelector('[data-part="root-cause-line"]')).toBeNull()
    expect(container.textContent).toContain("Error message")
    expect(container.textContent).toContain("The engine cut this text off.")
  })

  it("asks for its text at once, and once, where it opens from the start without a read", () => {
    const { region, onRead, view } = textOf({ defaultOpen: true })

    expect(onRead).toHaveBeenCalledTimes(1)
    expect(region.getByRole("status").textContent).toBe("Reading the text…")
    view.rerender(
      <LocaleProvider locale="en">
        <IncidentText
          kind="stacktrace"
          defaultOpen
          onRead={() => {
            onRead()
          }}
          slots={editorInstanceSlots().slots}
        />
      </LocaleProvider>,
    )
    fireEvent.click(region.getByRole("button", { name: "Hide stacktrace" }))
    fireEvent.click(region.getByRole("button", { name: "Show stacktrace" }))
    expect(onRead).toHaveBeenCalledTimes(1)
  })

  it("says a failed read and reads again on request, never again by itself once it was read", () => {
    const failed = textOf({ defaultOpen: true, read: { status: "failed" } })

    expect(failed.region.getByRole("alert").textContent).toContain("Pulse couldn't read the text.")
    fireEvent.click(failed.region.getByRole("button", { name: "Try again" }))
    expect(failed.onRead).toHaveBeenCalledTimes(1)
    cleanup()

    const read = textOf({ read: READ })
    fireEvent.click(read.region.getByRole("button", { name: "Show stacktrace" }))
    expect(read.onRead).not.toHaveBeenCalled()
  })

  it("says a refused read in the surface's words, with no retry", () => {
    const refused = textOf({
      defaultOpen: true,
      read: { status: "refused", reason: "The engine has no text for this incident any more." },
    })

    expect(refused.region.getByRole("status").textContent).toBe(
      "The engine has no text for this incident any more.",
    )
    expect(refused.region.queryByRole("alert")).toBeNull()
    expect(refused.region.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(refused.onRead).not.toHaveBeenCalled()
  })

  it("speaks German under a German locale", () => {
    const { region, container } = textOf({ kind: "errorMessage", read: READ }, "de")

    fireEvent.click(region.getByRole("button", { name: "Fehlermeldung zeigen" }))

    expect(region.getByRole("button", { name: "Fehlermeldung kopieren" })).toBeTruthy()
    expect(region.getByRole("button", { name: "Zeilen umbrechen" })).toBeTruthy()
    expect(container.querySelector('[data-part="root-cause-line"]')?.textContent).toContain(
      "← Grundursache",
    )
  })
})
